# Abridger — Original Product Brief

This file is the frozen, verbatim product brief that initiated this project. Do not modify it. The current implementation plan lives in the repo's planning artifacts and in the `README.md`; this file exists so future contributors can read what was originally asked for, unfiltered.

---

Open source AI project to abridge books – PDFs and EPUBS.

Remote: `git@github.com:willyd332/Abridger.git` — all it has is license file

Idea:
- User provides Anthropic or OpenAI API key
- User uploads PDF or EPUB
- User explains why they want to read the book — i.e. what they are trying to get out of it
- Then, an AI system that abridges the book according to both their instructions and best practices; formatting the final document in a clean way.

A few things about this that require a custom app:

(1) when a section is removed, a quick little summary of what was removed should be added in `[brackets]` explaining it. Just like how in a bunch of legal textbooks, professors will abbreviate sections and put little summaries in `[brackets]`. These may be long summaries (up to two pages, or very short); it needs to be dynamic.

(2) formatting is important. For PDFs, abridged sections of the PDF need to be removed. This is easy if a full page needs to be removed, but if only a portion of a page needs to be cut, there needs to be a good way to cover that section up (i.e. by adding a shape on top of the PDF page). Also the bracket summaries need to be added, even where a bunch of pages are removed.

(3) the goal is to ABRIDGE the book; not to summarize it. In other words, the user still wants to be able to say they "read" the book. So it is not just a matter of "finding the specific piece of info that answers the user's purpose", but rather a matter of significantly reducing the length of the book—but still keeping it as a book and without making it unreadable as a book—while keeping in mind the users' instructions. Thus, often, important context, even if not directly related to users' goal, will need to be kept in, especially if it is key to the book's narrative / thesis / context. This will require some thinking in terms of how to write the prompts to make decisions.

(4) For EPUB, it will need to edit and insert into the EPUB file.

---

## Example

X is interested in writing an environmental history of Mao's Great Leap Forward (GLF).
X wants to abridge book, Y, which is a famous, comprehensive text about the GLF.
Y has a single chapter, Z, about the environmental history of the GLF.
However, the book as a whole makes some wider, important historiographical arguments and characterizations of the GLF that are essential to understanding chapter Z. For example:

- There are a few critical early chapters characterizing Mao's institutions and outlining the overall argument of the book.
- There are some other sections which characterize the GLF economy and which implicitly inform the arguments made in Chapter Z.
- Additionally, after Chapter Z, there are a few sections that are informed by Chapter Z, talking about, e.g., the lived experience of the rural population who were affected by the environmental damage.
- Finally, there may also be another chapter about the GLF political institutions, which, though not directly relevant to Chapter Z, are extremely important to the book overall—perhaps the book is actually famous for the arguments made in that chapter, and thus, just for pure intellectual interest, it would be very important for any reader to read that chapter.

In this case, a well-abridged text would solve these issues by allowing a researcher to understand the larger scope of the text, its characterizations, its wider arguments, its famous portions, etc. in addition to the obviously relevant environmental part, but without having to read, e.g., the 60-page tangent about Mao's early biography, or the chapter about the military, or the one about diplomacy (or limited portions thereof). If the original book, Y, is 750 pages, an abridged version might thus be 200-400 pages.

---

## The Approach, Technically

(a) First, we need to break down the book structurally, likely into chapters. This should be a loop of API calls, feeding a smaller AI 10 pages at a time, asking it to determine chapter cutoffs. This will ultimately leave us with a list of page numbers indicating the meaningful section cutoffs as a list of page numbers.

(b) Second, we build summaries. First, we build section-by-section summaries. A few paragraphs for each section outlining the subjects covered, the arguments presented, etc. It is a catalogue, at a high level, of the book. 1-3 paragraphs for each section, depending on section length. This should be done by a smarter model.

(c) Third, we determine, section by section, what text to keep, and what to drop. This process should follow two distinct steps:

  (c1) **Macro Filter**: at a high level, cut out pages / chapters entirely if they are unnecessary or totally tangential. Those should be cut / summarized. OR NOT CUT!

  (c2) **Micro Filter**: carefully, at the page level, if there are particular paragraphs/footnotes that could be dropped, those should be cut / summarized into a sentence. Careful with this. Standards should be high since the micro level is often very important for the rhetorical integrity!

(d) Finally, after all these decisions have been made, reconstruct the uploaded file with the abridgement/summaries applied and deliver to the user two files to download: the abridged text and a collection of the material removed in the form of a `.md` file describing what was removed in a simple, concise ledger.

---

## Aesthetic / UX Direction

Static app on GitHub Pages. Use Motion.Dev and nice loading animations that allow the user to see what is going on at all times. It should be really satisfying to watch the abridgement (e.g. custom animations showing how the AI is splitting up the sections, then flipping pages as it abridges them in parallel, then reconstructs). Imagine a grid of sections with pages flipping, etc. Think ancient-library website aesthetic.
