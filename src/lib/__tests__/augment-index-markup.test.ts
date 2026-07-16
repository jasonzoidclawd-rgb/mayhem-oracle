import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

const source = readFileSync(
  path.join(process.cwd(), "src/components/augments/AugmentsClient.tsx"),
  "utf8",
);
const pageSource = readFileSync(
  path.join(process.cwd(), "src/app/[locale]/augments/page.tsx"),
  "utf8",
);
const notesStart = source.indexOf("function GameNotes()");
const notesEnd = source.indexOf("function NoteBlock", notesStart);
const notesSource = source.slice(notesStart, notesEnd);

describe("augment index markup", () => {
  test("keeps game-note copy in non-paragraph containers", () => {
    expect(notesSource).not.toMatch(/<p\b|<\/p>/);
    expect(notesSource).toContain("Bread Sandwich Combo");
    expect(notesSource).toContain("Source: wiki.leagueoflegends.com/en-us/ARAM:_Mayhem/Augments");
  });

  test("does not rehydrate raw augment win-rate fields into the public page", () => {
    expect(pageSource).not.toContain("win_rate:");
  });
});
