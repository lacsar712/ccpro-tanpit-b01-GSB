from pits.models import LiquorSample, Pit, RowCap, User, Yard

# 每排鞣制中并存上限（坑位数减一，留一口给注液/放液周转）
DEFAULT_ROW_CAPS = {0: 1, 1: 1, 2: 1}


def seed_demo() -> None:
    admin, _ = User.objects.get_or_create(username="admin", defaults={"role": "admin"})
    admin.role = "admin"
    admin.set_password("123456")
    admin.save()
    worker, _ = User.objects.get_or_create(username="worker", defaults={"role": "worker"})
    worker.role = "worker"
    worker.set_password("123456")
    worker.save()
    if Yard.objects.exists():
        yard = Yard.objects.first()
    else:
        yard = Yard.objects.create(name="南冈鞣场", village="青皮村")
        layout = [
            ("东-1", Pit.STATUS_TANNING, 0, 0, 4.2),
            ("东-2", Pit.STATUS_FILL, 0, 1, None),
            ("中-1", Pit.STATUS_DRAINED, 1, 0, 4.6),
            ("中-2", Pit.STATUS_TANNING, 1, 1, 6.1),
            ("西-1", Pit.STATUS_FILL, 2, 0, None),
            ("西-2", Pit.STATUS_DRAINED, 2, 1, 3.8),
        ]
        for code, status, row, col, ph in layout:
            pit = Pit.objects.create(yard=yard, code=code, status=status, row=row, col=col)
            if ph is not None:
                LiquorSample.objects.create(pit=pit, ph=ph, operator="worker")
    for row, cap in DEFAULT_ROW_CAPS.items():
        if yard.pits.filter(row=row).exists():
            RowCap.objects.get_or_create(yard=yard, row=row, defaults={"cap": cap, "enabled": True})
