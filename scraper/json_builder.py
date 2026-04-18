"""
json_builder.py — Scrive tutti i file JSON in data/
"""
import json
from pathlib import Path


def write_json(path: Path, data):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    print(f"      ✓ {path.name} ({len(data) if isinstance(data, (list, dict)) else '—'})")


def write_all_json(
    calendar: list,
    results_raw: list,
    athletes: dict,
    teams: dict,
    rankings: dict,
    data_dir: Path,
):
    rankings_dir = data_dir / "rankings"
    rankings_dir.mkdir(parents=True, exist_ok=True)

    write_json(data_dir / "calendar.json", calendar)
    write_json(data_dir / "results_raw.json", results_raw)
    write_json(data_dir / "athletes.json", athletes)
    write_json(data_dir / "teams.json", teams)

    # Genera meta.json
    from datetime import datetime
    meta = {
        "last_update": datetime.now().isoformat(),
        "season": CURRENT_YEAR if 'CURRENT_YEAR' in globals() else datetime.now().year,
        "results_count": len(results_raw)
    }
    write_json(data_dir / "meta.json", meta)

    for cat_code, rows in rankings.items():
        write_json(rankings_dir / f"{cat_code}.json", rows)
