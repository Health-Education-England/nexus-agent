from __future__ import annotations

# Note: If VS Code shows a "Missing Import" error for 'pymupdf4llm' below,
# it means your editor is using the global Python interpreter instead of the local venv.
# To fix this: press Cmd+Shift+P -> "Python: Select Interpreter" -> "Enter interpreter path..."
# and select 'gold-guide-expert/venv/bin/python'.
import argparse
from pathlib import Path
import sys

import pymupdf4llm


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Convert a PDF to markdown.")
    parser.add_argument(
        "pdf_path",
        nargs="?",
        default="data/raw/Gold Guide 10th Edition August 2024.pdf",
        help="Path to the input PDF.",
    )
    parser.add_argument(
        "--output",
        default="data/markdown/_raw_parsed.md",
        help="Path to the output markdown file.",
    )
    return parser.parse_args()


def normalize_md_text(md_text: object) -> str:
    if isinstance(md_text, list):
        return "\n\n".join(
            item.get("text", "") if isinstance(item, dict) else str(item)
            for item in md_text
        )
    return str(md_text)


def main() -> int:
    args = parse_args()
    pdf_path = Path(args.pdf_path)
    md_path = Path(args.output)

    if not pdf_path.exists():
        print(f"Input PDF not found: {pdf_path}", file=sys.stderr)
        return 1

    try:
        md_text = pymupdf4llm.to_markdown(str(pdf_path))
    except Exception as exc:
        print(f"Failed to parse PDF: {exc}", file=sys.stderr)
        return 1

    md_text = normalize_md_text(md_text)
    md_path.parent.mkdir(parents=True, exist_ok=True)
    md_path.write_text(md_text, encoding="utf-8")
    print(f"Successfully parsed PDF to {md_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
