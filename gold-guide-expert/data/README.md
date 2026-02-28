# Gold Guide Expert Data

## Directory Structure

- `raw/` for the original source PDF
- `markdown/` for the parsed Markdown output
- `qa/` for curated QA datasets (e.g. golden datasets)
- `artifacts/` for any derived files

## Step 1: Parsing the PDF to Markdown

To build an accurate RAG/CAG pipeline, Python PDF extractors get top reviews so first tried **PyMuPDF4LLM** an extension of PyMuPDF.
It was very fast, required no heavy ML models, and did a good job in the main to produce an accurate Markdown document from the original Gold Guide PDF document.

### Two manual tweaks needed

- I did have to make one manual tweak due to PyMuPDF4LLM's failure to extract the complex ARCP Outcomes tables (pages 74-79) to Markdown.So I gave my friendly LLM (Gemini 3.1 Pro) the PDF screenshots and got it to transcribe/inject the missing data manually as clean, semantic heading/paragraph Markdown rather than the weird table from the original PDF.

- I also fixed a native numbering typo in the original PDF (Section 1.15's first subsection was incorrectly labelled '1.15', changed to '1.15 i').

### How to reproduce the parsing locally

To reproduce the Python parsing setup, see the Node `package.json` scripts.

If you are cloning this repository for the first time, follow these steps to recreate the `venv` environment and generate the parsed Markdown file:

**1. Setup the Python Environment**
From the root of the `nexus-agent` project, run:

```bash
npm run docs:setup-parser
```

_This command will CD into `gold-guide-expert`, create a local `venv` (virtual environment), activate it, and install the required Python libraries via `scripts/requirements.txt`._

**2. Run the Parsing Script**
Once the environment is setup, run:

```bash
npm run docs:parse
```

*This will execute `scripts/parse-pdf.py` which reads the raw PDF and saves the resulting raw Markdown into `data/markdown/_raw_parsed.md`.*

**Note on Manual Tweaks:**
Due to extreme layout complexity on pages 74-79 of the Gold Guide (nested annotations within grids), PyMuPDF4LLM failed to extract the ARCP Outcomes effectively. This section was transcribed manually and injected. 

The fully prepared, post-tweaked Markdown file is saved as **`data/markdown/gold_guide_10th_ed_base.md`**. This `_base.md` file serves as the definitive source block for all subsequent metadata canonicalization (Step 2). Running `docs:parse` will only ever overwrite `_raw_parsed.md` to protect these manual interventions.
