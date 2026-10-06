"""鞣坑作业规则。

- 放液门槛：最近一次浸液酸碱度须在 3.5～5.0。
- 行口上限：开关打开时，同一排处于「鞣制中」的坑数不得超过该排上限。
"""

from pits.models import Pit, RowCap

MIN_PH = 3.5
MAX_PH = 5.0


class RuleError(ValueError):
    pass


def latest_ph(pit: Pit) -> float | None:
    sample = pit.samples.order_by("-taken_at", "-id").first()
    return None if sample is None else sample.ph


def assert_can_set_status(pit: Pit, new_status: str) -> None:
    allowed = {Pit.STATUS_FILL, Pit.STATUS_TANNING, Pit.STATUS_DRAINED}
    if new_status not in allowed:
        raise RuleError(f"无效状态：{new_status}")
    if new_status != Pit.STATUS_DRAINED:
        return
    ph = latest_ph(pit)
    if ph is None:
        raise RuleError("该坑尚无浸液酸碱记录，不能放液")
    if ph < MIN_PH or ph > MAX_PH:
        raise RuleError(f"最近酸碱度 {ph} 不在 {MIN_PH}～{MAX_PH}，不能放液")


def assert_row_capacity(yard_id: int, row: int) -> RowCap | None:
    """进入「鞣制中」前的行口校验。必须在事务内调用。

    先对该排行口记录上行锁，使同一排的并发状态变更串行化；
    开关关闭或该行未设上限时放行。计数只看本排，与别的行无关。
    """
    cap = (
        RowCap.objects.select_for_update()
        .filter(yard_id=yard_id, row=row)
        .first()
    )
    if cap is None or not cap.enabled:
        return cap
    used = Pit.objects.filter(
        yard_id=yard_id, row=row, status=Pit.STATUS_TANNING
    ).count()
    if used >= cap.cap:
        raise RuleError(
            f"该行鞣制中口数已满（{used}/{cap.cap}），不能再拨成鞣制中"
        )
    return cap
