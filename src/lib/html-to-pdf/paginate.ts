import type { AtomicBox, PageGeometry } from "./types";
import { CONTENT_HEIGHT_PX } from "./types";

/** How far up a page we are willing to break early to keep a block intact. */
const MAX_ORPHAN_PULL = 0.35;
/**
 * A line's measured box is the font's ascent-to-descent span; ink can sit a
 * shade outside it. Clearing a couple of pixels keeps descenders whole.
 */
const INK_BLEED = 2;

/**
 * Choose page break positions down the document.
 *
 * A break lands on the ideal page height unless a line or an image straddles
 * it, in which case it moves up to the top of that block — the same rule a
 * print engine applies, and the reason text does not get sliced through the
 * middle of a letter.
 */
export function paginate(contentHeight: number, boxes: AtomicBox[], forcedBreaks: number[]): PageGeometry {
  const sorted = [...boxes].sort((a, b) => a.top - b.top);
  const breaks: number[] = [0];
  let top = 0;
  let guard = 0;

  while (top + CONTENT_HEIGHT_PX < contentHeight - 0.5) {
    if (++guard > 5000) break;
    const ideal = top + CONTENT_HEIGHT_PX;
    const floor = top + CONTENT_HEIGHT_PX * MAX_ORPHAN_PULL;

    const forced = forcedBreaks.find((y) => y > top + 1 && y <= ideal);
    let next = forced ?? ideal;

    if (forced === undefined) {
      // The highest block that the ideal break would cut in half.
      let cut = ideal;
      for (const box of sorted) {
        if (box.top >= ideal) break;
        if (box.bottom + INK_BLEED > ideal && box.top > floor && box.top < cut) cut = box.top;
      }
      next = cut;
    }

    if (next <= top + 1) next = ideal;
    breaks.push(next);
    top = next;
  }

  return { breaks, contentHeight };
}
