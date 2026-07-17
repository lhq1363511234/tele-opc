import importlib.util
from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[2]
SCRAPER_PATH = ROOT / "runtime" / "inbeidou-cps-skill" / "inbeidou-cps" / "scripts" / "cps_scrape.py"


def load_scraper():
    spec = importlib.util.spec_from_file_location("cps_scrape", SCRAPER_PATH)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


class InbeidouCpsScrapeTests(unittest.TestCase):
    def test_detects_all_episode_tabs_from_catalog_snapshot(self):
        scraper = load_scraper()
        snapshot = [
            {"text": "1", "ariaLabel": "", "className": "catalog-item active"},
            {"text": "2", "ariaLabel": "", "className": "catalog-item"},
            {"text": "3", "ariaLabel": "", "className": "catalog-item"},
            {"text": "4", "ariaLabel": "", "className": "catalog-item"},
            {"text": "5", "ariaLabel": "", "className": "catalog-item"},
            {"text": "下载本集", "ariaLabel": "", "className": "catalog-header-down download"},
            {"text": "批量导出", "ariaLabel": "", "className": "catalog-header-down"},
        ]

        self.assertEqual(scraper.find_episode_numbers(snapshot, expected_count=5), [1, 2, 3, 4, 5])


if __name__ == "__main__":
    unittest.main()
