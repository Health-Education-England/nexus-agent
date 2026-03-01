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

_This will execute `scripts/parse-pdf.py` which reads the raw PDF and saves the resulting raw Markdown into `data/markdown/_raw_parsed.md`._

**Note on Manual Tweaks:**
Due to extreme layout complexity on pages 74-79 of the Gold Guide (nested annotations within grids), PyMuPDF4LLM failed to extract the ARCP Outcomes effectively. This section was transcribed manually and injected.

The fully prepared, post-tweaked Markdown file is saved as **`data/markdown/gold_guide_10th_ed_base.md`**. This `_base.md` file serves as the definitive source block for all subsequent metadata canonicalization (Step 2). Running `docs:parse` will only ever overwrite `_raw_parsed.md` to protect these manual interventions.

## Step 2: Canonicalising the Markdown

To build an accurate Retrieval pipeline and to evaluate output through automated testing, we need Immutable IDs for every document chunk, ensuring repeatable and verifiable citations.

**1. Clean Markdown**
First, we run a cleanup step on `gold_guide_10th_ed_base.md` to programmatically:

- Strip the table of contents
- Remove repeating PDF page footers (version line + page numbers)
- Extract inline PDF page-footnotes (e.g. `6 Postgraduate Deans do not have...`) and re-attach each one to the block containing its `[N]` reference marker, preserving the supplementary context inline
- Restore paragraph breaks before anchor-numbered clauses that were merged across page boundaries during footer removal
- Un-wrap rigid mid-sentence line breaks from PDF column widths to restore proper paragraph structure

```bash
npm run docs:clean
```

_Outputs: `data/markdown/gold_guide_10th_ed_clean.md`_

**2. Canonicalise and Chunk**
Next, we parse the cleaned markdown top-to-bottom. We identify state changes (like Section Headers) and anchor the chunks to the strict Gold Guide numeration system (e.g. `1.15`, `2.42`, `3.107 ii`). If standard paragraphs or lists fall under an anchor, they are absorbed into the parent chunk as vital context.

```bash
npm run docs:canonicalise
```

_Outputs: `data/raw/gold_guide_canonical.jsonl`_

_(You can run the entire pipeline top-to-bottom by typing `npm run docs` in the root folder)._

## Step 3: Generating the "Golden Dataset" (Development QA Set)

To enable automated evaluation of the naive LLM generation, we established a "baseline" dataset to measure the correctness and precision of AI answers.

A seed JSON array of Question/Answer test cases was created at `data/qa/development.json`, featuring 10 manually curated, diverse, and representative questions sourced from `gold_guide_canonical.jsonl`.

Each test case consists of:

- An `id` (e.g., `"dev-001"`)
- The `question`
- The `expectedAnswer`
- The `requiredCitations` specifying exactly what Canonical IDs the model must cite (e.g., `["1.15 i"]`)
- A `severity` weight (`CRITICAL`, `HIGH` or `LOW`) for pass/fail scoring heuristics
- Additional tags to help classify failures (e.g., `"single-hop"`, `"ltft"`, `"cross-reference"`)

A `loadDataset()` utility was implemented in the evaluation module (`gold-guide-expert/evaluation/config.ts`) to programmatically load this golden dataset for testing execution, available via testing scripts.

```bash
# TODO (Requires test harness implementation)
npm run eval:dev
```
