#!/usr/bin/env python3
import unittest

from build_tencent_feed import classify_tencent_status


class TencentFeedSectionTests(unittest.TestCase):
    def test_removed_section_does_not_corroborate_live(self):
        text = (
            "海克斯大乱斗 已移除的强化符文 ？？？ 一板一眼 "
            "新增的强化符文 白银阶强化符文 任务：主玩辅助 "
            "强化符文调整 亮出你的剑 已禁用的强化符文 刃下生风 "
            "地图与系统更新 斗魂竞技场 BUG修复 珠光护手"
        )

        self.assertEqual(classify_tencent_status(text, ["一板一眼"])["tencent_status"], "removed")
        self.assertEqual(classify_tencent_status(text, ["任务：主玩辅助"])["tencent_status"], "live")
        self.assertEqual(classify_tencent_status(text, ["刃下生风"])["tencent_status"], "disabled")
        self.assertIsNone(classify_tencent_status(text, ["珠光护手"])["tencent_status"])


if __name__ == "__main__":
    unittest.main()
