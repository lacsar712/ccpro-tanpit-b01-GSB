from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

from django.db import connection, transaction
from django.test import Client, TransactionTestCase, skipUnlessDBFeature

from pits.auth import make_token
from pits.models import LiquorSample, Pit, RowCap, User, Yard


def make_yard():
    yard = Yard.objects.create(name="测试鞣场", village="青皮村")
    pits = {}
    layout = [
        ("东-1", 0, 0, Pit.STATUS_FILL),
        ("东-2", 0, 1, Pit.STATUS_FILL),
        ("东-3", 0, 2, Pit.STATUS_FILL),
        ("中-1", 1, 0, Pit.STATUS_FILL),
        ("中-2", 1, 1, Pit.STATUS_FILL),
    ]
    for code, row, col, status in layout:
        pits[code] = Pit.objects.create(yard=yard, code=code, status=status, row=row, col=col)
    return yard, pits


class ApiClient(Client):
    def __init__(self, username):
        super().__init__()
        self.token = make_token(username)

    def call(self, method, path, data=None):
        fn = getattr(self, method)
        return fn(f"/api{path}", data=data, content_type="application/json",
                  HTTP_AUTHORIZATION=f"Bearer {self.token}")


class RowCapRuleTests(TransactionTestCase):
    def setUp(self):
        self.admin_user = User.objects.create(username="admin", role="admin")
        self.admin_user.set_password("x")
        self.admin_user.save()
        self.worker_user = User.objects.create(username="worker", role="worker")
        self.worker_user.set_password("x")
        self.worker_user.save()
        self.yard, self.pits = make_yard()
        RowCap.objects.create(yard=self.yard, row=0, cap=1, enabled=True)
        RowCap.objects.create(yard=self.yard, row=1, cap=1, enabled=True)
        self.admin = ApiClient("admin")
        self.worker = ApiClient("worker")

    def set_status(self, client, code, status):
        return client.call("post", f"/pits/{self.pits[code].id}/status", {"status": status})

    def test_full_row_blocks_tanning_with_chinese_message(self):
        res = self.set_status(self.worker, "东-1", Pit.STATUS_TANNING)
        self.assertEqual(res.status_code, 200)
        res = self.set_status(self.worker, "东-2", Pit.STATUS_TANNING)
        self.assertEqual(res.status_code, 400)
        self.assertIn("已满", res.json()["detail"])
        self.pits["东-2"].refresh_from_db()
        self.assertEqual(self.pits["东-2"].status, Pit.STATUS_FILL)

    def test_switch_off_allows_over_cap(self):
        self.set_status(self.worker, "东-1", Pit.STATUS_TANNING)
        res = self.admin.call("post", "/rows/0", {"cap": 1, "enabled": False})
        self.assertEqual(res.status_code, 200)
        res = self.set_status(self.worker, "东-2", Pit.STATUS_TANNING)
        self.assertEqual(res.status_code, 200, res.content)
        self.pits["东-2"].refresh_from_db()
        self.assertEqual(self.pits["东-2"].status, Pit.STATUS_TANNING)

    def test_other_row_unaffected(self):
        self.set_status(self.worker, "东-1", Pit.STATUS_TANNING)
        res = self.set_status(self.worker, "中-1", Pit.STATUS_TANNING)
        self.assertEqual(res.status_code, 200)
        res = self.set_status(self.worker, "中-2", Pit.STATUS_TANNING)
        self.assertEqual(res.status_code, 400)

    def test_leaving_tanning_frees_slot(self):
        self.set_status(self.worker, "东-1", Pit.STATUS_TANNING)
        self.assertEqual(self.set_status(self.worker, "东-2", Pit.STATUS_TANNING).status_code, 400)
        LiquorSample.objects.create(pit=self.pits["东-1"], ph=4.2, operator="w")
        self.set_status(self.worker, "东-1", Pit.STATUS_DRAINED)
        res = self.set_status(self.worker, "东-2", Pit.STATUS_TANNING)
        self.assertEqual(res.status_code, 200, res.content)

    def test_samples_and_drained_do_not_consume_cap(self):
        # 登记酸碱度与已放液不受行上限影响：满员行里照样操作
        self.set_status(self.worker, "东-1", Pit.STATUS_TANNING)
        res = self.worker.call("post", f"/pits/{self.pits['东-2'].id}/samples", {"ph": 4.0})
        self.assertEqual(res.status_code, 200)
        LiquorSample.objects.create(pit=self.pits["东-2"], ph=4.0, operator="w")
        res = self.set_status(self.worker, "东-2", Pit.STATUS_DRAINED)
        self.assertEqual(res.status_code, 200, res.content)

    def test_used_equals_tanning_pit_count(self):
        self.set_status(self.worker, "东-1", Pit.STATUS_TANNING)
        res = self.worker.call("get", "/rows")
        self.assertEqual(res.status_code, 200)
        rows = {r["row"]: r for r in res.json()["rows"]}
        self.assertEqual(rows[0]["used"], 1)
        self.assertEqual(rows[1]["used"], 0)
        self.assertEqual(rows[0]["cap"], 1)
        self.assertTrue(rows[0]["enabled"])

    def test_worker_read_only_dashboard(self):
        res = self.worker.call("get", "/rows")
        self.assertEqual(res.status_code, 200)
        res = self.worker.call("post", "/rows/0", {"cap": 2, "enabled": True})
        self.assertEqual(res.status_code, 403)
        self.assertEqual(RowCap.objects.get(yard=self.yard, row=0).cap, 1)

    def test_admin_updates_cap_and_switch(self):
        res = self.admin.call("post", "/rows/0", {"cap": 3, "enabled": True})
        self.assertEqual(res.status_code, 200)
        self.assertEqual(RowCap.objects.get(yard=self.yard, row=0).cap, 3)
        for code in ("东-1", "东-2"):
            self.assertEqual(self.set_status(self.worker, code, Pit.STATUS_TANNING).status_code, 200)

    def test_cap_must_be_positive_integer(self):
        res = self.admin.call("post", "/rows/0", {"cap": 0, "enabled": True})
        self.assertEqual(res.status_code, 400)
        self.assertIn("正整数", res.json()["detail"])
        res = self.admin.call("post", "/rows/0", {"cap": -2, "enabled": True})
        self.assertEqual(res.status_code, 400)

    def test_board_carries_rows(self):
        res = self.worker.call("get", "/board")
        self.assertEqual(res.status_code, 200)
        self.assertIn("rows", res.json())
        self.assertEqual(res.json()["role"], "worker")


@skipUnlessDBFeature("has_select_for_update")
class RowCapConcurrencyTests(TransactionTestCase):
    def setUp(self):
        user = User.objects.create(username="worker", role="worker")
        user.set_password("x")
        user.save()
        self.yard, self.pits = make_yard()
        RowCap.objects.create(yard=self.yard, row=0, cap=1, enabled=True)
        RowCap.objects.create(yard=self.yard, row=1, cap=1, enabled=True)

    def _race_to_tanning(self, codes):
        barrier = Barrier(len(codes))

        def one(code):
            try:
                client = ApiClient("worker")
                barrier.wait(timeout=30)
                return client.call(
                    "post", f"/pits/{self.pits[code].id}/status", {"status": Pit.STATUS_TANNING}
                ).status_code
            finally:
                connection.close()

        with ThreadPoolExecutor(max_workers=len(codes)) as pool:
            return list(pool.map(one, codes))

    def test_race_for_last_slot_only_one_wins(self):
        statuses = self._race_to_tanning(["东-1", "东-2"])
        self.assertEqual(sorted(statuses), [200, 400], statuses)
        tanning = Pit.objects.filter(yard=self.yard, row=0, status=Pit.STATUS_TANNING).count()
        self.assertEqual(tanning, 1)

    def test_two_more_when_row_full_both_lose(self):
        # 行口已顶格（1/1），两名工同时再把该行两口注液拨成鞣制中：两笔都落空，库里仍是 1。
        pit = self.pits["东-1"]
        with transaction.atomic():
            pit.status = Pit.STATUS_TANNING
            pit.save(update_fields=["status"])
        self.assertEqual(Pit.objects.filter(row=0, status=Pit.STATUS_TANNING).count(), 1)
        statuses = self._race_to_tanning(["东-2", "东-3"])
        self.assertEqual(sorted(statuses), [400, 400], statuses)
        self.assertEqual(Pit.objects.filter(row=0, status=Pit.STATUS_TANNING).count(), 1)
        for code in ("东-2", "东-3"):
            self.pits[code].refresh_from_db()
            self.assertEqual(self.pits[code].status, Pit.STATUS_FILL)
