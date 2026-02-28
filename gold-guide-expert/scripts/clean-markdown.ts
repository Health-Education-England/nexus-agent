import * as fs from "node:fs/promises";
import * as path from "node:path";

async function clean() {
  const inputPath = path.join(
    process.cwd(),
    "gold-guide-expert",
    "data",
    "markdown",
    "gold_guide_10th_ed_base.md"
  );
  const outputPath = path.join(
    process.cwd(),
    "gold-guide-expert",
    "data",
    "markdown",
    "gold_guide_10th_ed_clean.md"
  );

  console.log(`Reading from ${inputPath}...`);
  let text = await fs.readFile(inputPath, "utf8");

  // 1. Remove TOC (everything before the actual start of Section 1)
  const startMarker = "#### **Section 1: Introduction and background**";
  const splitIndex = text.indexOf(startMarker);
  if (splitIndex !== -1) {
    text = text.substring(splitIndex);
  } else {
    console.warn("Could not find start marker for Section 1. Keeping TOC.");
  }

  // 2. Remove footers
  // Use capture groups to detect if the footer interrupts a sentence or paragraph.
  // If preceded by a letter, comma, or hyphen, it's mid-sentence -> replace with single newline (which will be un-wrapped later).
  text = text.replace(
    /([a-zA-Z\,\-])\n+Gold Guide version 10, August 2024\n+\d+\n+/g,
    "$1\n"
  );
  // Otherwise, assume it's the end of a sentence/paragraph -> replace with double newline to preserve block boundary.
  text = text.replace(
    /([^a-zA-Z\,\-])\n+Gold Guide version 10, August 2024\n+\d+\n+/g,
    "$1\n\n"
  );

  // 3. Ensure anchor-numbered paragraphs (e.g. "4.54 The…") always start a new
  //    block. Footer removal can leave them joined to the preceding paragraph
  //    via a single newline when the previous text ends with a letter.
  //    Only break when the anchor is followed by a capital letter (new clause)
  //    to avoid splitting cross-references like "paragraph 3.119 and 3.120)."
  text = text.replace(/(?<!\n)\n(\d+\.\d+\s+[A-Z])/g, "\n\n$1");

  // 4. Split into blocks, then extract PDF page-footnotes and re-attach them
  //    to the blocks that reference them via [N] markers.
  //    Footnotes are bare numbers (1–29) followed by prose or a link – distinct
  //    from anchors (e.g. "2.37 The…") and numbered list items (e.g. "1. Approval…").
  const allBlocks = text.split(/\n\n+/);

  const footnotePattern = /^\d{1,2}\s+(?:[A-Z\[])/;
  const isFootnote = (block: string): boolean => {
    const t = block.trim();
    return footnotePattern.test(t) && !/^\d+\./.test(t);
  };

  // Extract footnotes into a map: footnote number -> footnote text
  const footnoteMap = new Map<string, string>();
  const contentBlocks: string[] = [];

  for (const block of allBlocks) {
    if (isFootnote(block)) {
      const match = block.trim().match(/^(\d{1,2})\s+([\s\S]*)/);
      if (match) {
        footnoteMap.set(match[1], match[2].trim());
      }
    } else {
      contentBlocks.push(block);
    }
  }

  console.log(
    `Extracted ${footnoteMap.size} footnotes to re-attach to referencing blocks.`
  );

  // 5. Un-wrap mid-sentence line breaks
  const unWrappedBlocks = contentBlocks.map(block => {
    // preserve headings
    if (block.startsWith("#")) return block;

    // Remove single newlines, replace with space
    return block.replace(/\n/g, " ").replace(/\s{2,}/g, " ");
  });

  // 6. Re-attach each footnote to the last block that contains its [N] marker.
  //    Append as a parenthetical note so it's semantically inline.
  let reattachedCount = 0;
  for (const [num, fnText] of footnoteMap) {
    const marker = `[${num}]`;
    // Find the last block containing this marker (footnotes reference backwards/upwards)
    let targetIdx = -1;
    for (let i = unWrappedBlocks.length - 1; i >= 0; i--) {
      if (unWrappedBlocks[i].includes(marker)) {
        targetIdx = i;
        break;
      }
    }
    if (targetIdx !== -1) {
      // Un-wrap the footnote text the same way as content blocks
      const cleanFn = fnText.replace(/\n/g, " ").replace(/\s{2,}/g, " ");
      unWrappedBlocks[targetIdx] += `\n\n(Footnote ${num}: ${cleanFn})`;
      reattachedCount++;
    } else {
      console.warn(`Warning: no [${num}] marker found for footnote ${num}`);
    }
  }

  console.log(
    `Re-attached ${reattachedCount}/${footnoteMap.size} footnotes to their referencing blocks.`
  );

  const outputText = unWrappedBlocks.join("\n\n");

  await fs.writeFile(outputPath, outputText, "utf8");
  console.log(`Cleaned markdown saved to ${outputPath}`);
}

clean().catch(console.error);
