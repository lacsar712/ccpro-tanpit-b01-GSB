from django.db import transaction
from ninja import NinjaAPI, Schema
from ninja.errors import HttpError

from pits.auth import BearerAuth, make_token
from pits.models import Pit, RowCap, User, Yard
from pits.rules import RuleError, assert_can_set_status, assert_row_capacity, latest_ph

api = NinjaAPI(title="TanPit", urls_namespace="tanpit")
auth = BearerAuth()


class LoginIn(Schema):
    username: str
    password: str


class SampleIn(Schema):
    ph: float


class StatusIn(Schema):
    status: str


class RowCapIn(Schema):
    cap: int
    enabled: bool


def pit_json(pit: Pit) -> dict:
    return {
        "id": pit.id,
        "code": pit.code,
        "status": pit.status,
        "row": pit.row,
        "col": pit.col,
        "latestPh": latest_ph(pit),
        "sampleCount": pit.samples.count(),
    }


def get_yard() -> Yard:
    yard = Yard.objects.prefetch_related("pits__samples", "row_caps").first()
    if yard is None:
        raise HttpError(404, "尚无鞣场")
    return yard


def row_label(row: int, pits: list[Pit]) -> str:
    prefixes = {p.code.split("-", 1)[0] for p in pits if "-" in p.code}
    if len(prefixes) == 1:
        prefix = next(iter(prefixes))
        return prefix if prefix.endswith("排") else f"{prefix}排"
    return f"第{row + 1}排"


def rows_json(yard: Yard) -> list[dict]:
    pits = list(yard.pits.all())
    caps = {c.row: c for c in yard.row_caps.all()}
    rows = sorted({p.row for p in pits} | set(caps))
    result = []
    for row in rows:
        row_pits = [p for p in pits if p.row == row]
        cap = caps.get(row)
        result.append({
            "row": row,
            "label": row_label(row, row_pits),
            "cap": cap.cap if cap is not None else None,
            "enabled": cap.enabled if cap is not None else True,
            "used": sum(p.status == Pit.STATUS_TANNING for p in row_pits),
        })
    return result


def require_admin(request) -> User:
    if request.auth.role != "admin":
        raise HttpError(403, "仅管理员可改行口设置")
    return request.auth


@api.post("/auth/login")
def login(request, payload: LoginIn):
    user = User.objects.filter(username=payload.username).first()
    if user is None or not user.check_password(payload.password):
        raise HttpError(401, "用户名或密码错误")
    return {"access_token": make_token(user.username), "user": {"username": user.username, "role": user.role}}


@api.get("/auth/me", auth=auth)
def me(request):
    user = request.auth
    return {"username": user.username, "role": user.role}


@api.get("/health")
def health(request):
    return {"status": "ok", "service": "TanPit"}


@api.get("/board", auth=auth)
def board(request):
    yard = get_yard()
    pits = sorted(yard.pits.all(), key=lambda p: (p.row, p.col))
    return {
        "yard": yard.name,
        "village": yard.village,
        "pits": [pit_json(p) for p in pits],
        "rows": rows_json(yard),
        "role": request.auth.role,
    }


@api.get("/rows", auth=auth)
def list_rows(request):
    yard = get_yard()
    return {"rows": rows_json(yard), "role": request.auth.role}


@api.post("/rows/{row}", auth=auth)
def set_row_cap(request, row: int, payload: RowCapIn):
    require_admin(request)
    if payload.cap < 1:
        raise HttpError(400, "鞣制中并存上限须为正整数")
    yard = get_yard()
    if not yard.pits.filter(row=row).exists():
        raise HttpError(404, "没有这一排")
    cap = yard.row_caps.filter(row=row).first()
    if cap is None:
        cap = RowCap(yard=yard, row=row)
    cap.cap = payload.cap
    cap.enabled = payload.enabled
    cap.save()
    yard.refresh_from_db()
    yard = Yard.objects.prefetch_related("pits", "row_caps").get(id=yard.id)
    return {"rows": rows_json(yard)}


@api.post("/pits/{pit_id}/samples", auth=auth)
def add_sample(request, pit_id: int, payload: SampleIn):
    pit = Pit.objects.filter(id=pit_id).first()
    if pit is None:
        raise HttpError(404, "坑不存在")
    pit.samples.create(ph=payload.ph, operator=request.auth.username)
    pit.refresh_from_db()
    return pit_json(pit)


@api.post("/pits/{pit_id}/status", auth=auth)
def set_status(request, pit_id: int, payload: StatusIn):
    # 行锁顺序固定为「坑 → 行口」：同排并发在此串行，计数不会超卖；别的行走别的锁，互不影响。
    with transaction.atomic():
        pit = Pit.objects.select_for_update().filter(id=pit_id).first()
        if pit is None:
            raise HttpError(404, "坑不存在")
        try:
            assert_can_set_status(pit, payload.status)
            if payload.status == Pit.STATUS_TANNING and pit.status != Pit.STATUS_TANNING:
                assert_row_capacity(pit.yard_id, pit.row)
        except RuleError as exc:
            raise HttpError(400, str(exc))
        pit.status = payload.status
        pit.save(update_fields=["status"])
        pit.refresh_from_db()
    return pit_json(pit)
