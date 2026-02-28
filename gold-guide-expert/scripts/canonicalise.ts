import * as fs from "fs/promises";
import * as path from "path";

type Metadata = {
  section: string;
  heading: string;
  document: string;
  edition: string;
  url?: string;
};

type Chunk = {
  id: string;
  text: string;
  metadata: Metadata;
};

async function canonicalise() {
  const inputPath = path.join(
    process.cwd(),
    "gold-guide-expert",
    "data",
    "markdown",
    "gold_guide_10th_ed_clean.md"
  );
  const outputPath = path.join(
    process.cwd(),
    "gold-guide-expert",
    "data",
    "raw",
    "gold_guide_canonical.jsonl"
  );

  console.log(`Reading cleaned markdown from ${inputPath}...`);
  const text = await fs.readFile(inputPath, "utf8");

  const blocks = text.split(/\n\n+/);

  let currentMetadata: Metadata = {
    section: "",
    heading: "",
    document: "Gold Guide",
    edition: "10th"
  };

  let chunks: Chunk[] = [];
  let currentChunk: Chunk | null = null;
  let appendixMode = false;
  let fallbackIdCounter = 1;

  for (let block of blocks) {
    block = block.trim();
    if (!block) continue;

    // 1. Detect Sections (e.g. #### **Section 1: Introduction and background**)
    const sectionMatch = block.match(/^#{1,6}\s+\*\*(Section\s+\d+:.*?)\*\*$/i);
    if (sectionMatch) {
      currentMetadata.section = sectionMatch[1].trim();
      currentMetadata.heading = ""; // Reset heading
      continue; // Skip appending section title to chunks
    }

    // 1b. Detect Appendices (e.g. #### **Appendix 1** or similar)
    const appendixMatch = block.match(/^#{1,6}\s+\*\*(Appendix\s+.*?)\*\*$/i);
    if (appendixMatch || block === "**Gold Guide 10 appendices**") {
      appendixMode = true;
    }
    if (appendixMatch) {
      currentMetadata.section = appendixMatch[1].trim();
      currentMetadata.heading = "";
      continue;
    }

    // 2. Detect Headings (e.g. ###### **The UK health departments** or ### **Roles...**)
    const headingMatch = block.match(/^#{1,6}\s+\*\*(.*?)\*\*$/);
    if (headingMatch) {
      currentMetadata.heading = headingMatch[1].trim();
      // Don't continue because some chunk texts might just be headers
      continue;
    }

    // Strip formatting and leading list markers for matching logic (keep formatting in actual text)
    const plainBlock = block
      .replace(/\*\*/g, "")
      .replace(/^[-*]\s+/, "")
      .trim();

    // 3. Detect Anchor IDs
    // Regex looks for:
    // Start of string -> digit.digit+ -> optional roman numerals (i, ii, iv, v, x etc) -> space or end
    // e.g. "1.1 ", "1.15 i ", "3.107 ii "
    const anchorMatch = plainBlock.match(/^(\d+\.\d+(?:\s+[ivx]+)?)(?:\s|$)/i);

    if (anchorMatch && !appendixMode) {
      // New chunk detected!
      if (currentChunk) {
        // Ensure no trailing spaces, trim whitespace
        currentChunk.text = currentChunk.text.trim();
        chunks.push(currentChunk);
      }

      const newId = anchorMatch[1].toLowerCase().trim(); // Normalize id format

      currentChunk = {
        id: newId,
        text: block.replace(/^[-*]\s+/, ""), // Strip any stray list marker from the stored text
        metadata: {
          ...currentMetadata,
          url: `gold_guide_10th_ed_base.md#${newId.replace(/\s+/g, "-")}`
        }
      };
    } else {
      // No strict Anchor ID found in this block.

      if (currentChunk && !appendixMode) {
        // Append this list item/paragraph/footnote to the currently active Chunk
        currentChunk.text += `\n\n${block}`;
      } else if (appendixMode || !currentChunk) {
        // We are in Appendix mode (which lack strict numbering) or before any anchors
        // Create synthetic chunks for them
        const syntheticId = appendixMode
          ? `appendix-${fallbackIdCounter++}`
          : `intro-${fallbackIdCounter++}`;

        chunks.push({
          id: syntheticId,
          text: block,
          metadata: {
            ...currentMetadata,
            url: `gold_guide_10th_ed_base.md#${syntheticId}`
          }
        });
      }
    }
  }

  // Push the very last chunk if it exists
  if (currentChunk) {
    currentChunk.text = currentChunk.text.trim();
    chunks.push(currentChunk);
  }

  // Write to JSONL
  console.log(
    `Extracted ${chunks.length} canonical chunks. Writing to JSONL...`
  );
  const jsonl = chunks.map(c => JSON.stringify(c)).join("\n");
  await fs.writeFile(outputPath, jsonl, "utf8");

  console.log(`Successfully canonicalised to ${outputPath}`);
}

canonicalise().catch(console.error);
