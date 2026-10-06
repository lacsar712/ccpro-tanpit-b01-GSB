"""鞣坑规则：放液酸碱门槛 + 行口鞣制中并存上限。"""

from pits.models import Pit, RowCap

MIN_PH = 3.5
MAX_PH = 5.0


class RuleError(ValueError):
    pass


def latest_ph(pit: Pit) -> float | None:
    sample = pit.samples.order_by("-taken_at", "-id").first()
    return None if sample is None else sample.ph


def tanning_used(yard_id: int, row: int) -> int:
    """该行正处于鞣制中的坑数，即看板上的已用数。"""
    return Pit.objects.filter(yard_id=yard_id, row=row, status=Pit.STATUS_TANNING).count()


def assert_can_set_status(pit: Pit, new_status: str) -> None:
    allowed = {Pit.STATUS_FILL, Pit.STATUS_TANNING, Pit.STATUS_DRAINED}
    if new_status not in allowed:
        raise RuleError(f"无效状态：{new_status}")
    if new_status == Pit.STATUS_TANNING and pit.status != Pit.STATUS_TANNING:
        assert_row_cap(pit)
    if new_status != Pit.STATUS_DRAINED:
        return
    ph = latest_ph(pit)
    if ph is None:
        raise RuleError("该坑尚无浸液酸碱记录，不能放液")
    if ph < MIN_PH or ph > MAX_PH:
        raise RuleError(f"最近酸碱度 {ph} 不在 {MIN_PH}～{MAX_PH}，不能放液")


def assert_row_cap(pit: Pit) -> None:
    """开关打开且该行已用满上限时，挡住拨入鞣制中。

    须在事务里调用（接口已包 transaction.atomic）：对行口上限行加
    select_for_update，并发两笔拨入会排队逐一核对，不会双双放行。
    登酸碱、标已放液不走这里，不吃行上限。
    """
    cap = RowCap.objects.select_for_update().filter(yard_id=pit.yard_id, row=pit.row).first()
    if cap is None or not cap.enabled:
        return
    used = tanning_used(pit.yard_id, pit.row)
    if used >= cap.cap:
        raise RuleError(f"本行鞣制中已满（已用 {used} 口 / 上限 {cap.cap} 口），不能再拨入")
