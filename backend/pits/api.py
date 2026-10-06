from django.db import transaction
from ninja import NinjaAPI, Schema
from ninja.errors import HttpError

from pits.auth import BearerAuth, make_token
from pits.models import Pit, RowCap, User, Yard
from pits.rules import RuleError, assert_can_set_status, latest_ph, tanning_used

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


def row_label(pits, row: int) -> str:
    for pit in pits:
        if pit.row == row:
            head = pit.code.split("-")[0].strip()
            if head:
                return f"{head}排"
    return f"第{row + 1}行"


def row_json(yard, row: int, pits, caps) -> dict:
    cap = caps.get(row)
    return {
        "row": row,
        "label": row_label(pits, row),
        "cap": cap.cap if cap else None,
        "enabled": bool(cap and cap.enabled),
        "used": sum(1 for p in pits if p.row == row and p.status == Pit.STATUS_TANNING),
        "total": sum(1 for p in pits if p.row == row),
    }


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
    yard = Yard.objects.prefetch_related("pits__samples").first()
    if yard is None:
        raise HttpError(404, "尚无鞣场")
    pits = sorted(yard.pits.all(), key=lambda p: (p.row, p.col))
    return {"yard": yard.name, "village": yard.village, "pits": [pit_json(p) for p in pits]}


@api.get("/rows", auth=auth)
def list_rows(request):
    """行口看板：按行列出上限、开关、已用数。已用数 = 该行鞣制中坑数。"""
    yard = Yard.objects.prefetch_related("pits").first()
    if yard is None:
        raise HttpError(404, "尚无鞣场")
    pits = list(yard.pits.all())
    caps = {c.row: c for c in RowCap.objects.filter(yard=yard)}
    rows = sorted({p.row for p in pits})
    return {"yard": yard.name, "rows": [row_json(yard, r, pits, caps) for r in rows]}


def _set_row_cap(request, row: int, payload: RowCapIn):
    if request.auth.role != "admin":
        raise HttpError(403, "只有管理员能改行口上限与开关")
    if payload.cap < 1:
        raise HttpError(400, "行口上限须为正整数")
    yard = Yard.objects.first()
    if yard is None:
        raise HttpError(404, "尚无鞣场")
    if not Pit.objects.filter(yard=yard, row=row).exists():
        raise HttpError(404, "该行不存在")
    cap, _ = RowCap.objects.update_or_create(
        yard=yard, row=row, defaults={"cap": payload.cap, "enabled": payload.enabled}
    )
    return {
        "row": row,
        "cap": cap.cap,
        "enabled": cap.enabled,
        "used": tanning_used(yard.id, row),
    }


@api.put("/rows/{row}", auth=auth)
def put_row_cap(request, row: int, payload: RowCapIn):
    return _set_row_cap(request, row, payload)


@api.post("/rows/{row}", auth=auth)
def post_row_cap(request, row: int, payload: RowCapIn):
    return _set_row_cap(request, row, payload)


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
    with transaction.atomic():
        pit = Pit.objects.select_for_update().filter(id=pit_id).first()
        if pit is None:
            raise HttpError(404, "坑不存在")
        try:
            assert_can_set_status(pit, payload.status)
        except RuleError as exc:
            raise HttpError(400, str(exc))
        pit.status = payload.status
        pit.save(update_fields=["status"])
    return pit_json(pit)
