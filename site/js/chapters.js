// Cover artwork is front matter, separate from the numbered story-page files.
// Mark only each arc's first chapter with arc: 1..4 and opensArc: true.
// Chapter IDs are assigned during production, not inferred from story IDs.
window.REFLECTIONS_COVERS = {
  "1": {
    "src": "/images/covers/arc-01-three-become-one.webp",
    "alt": "Reflections, Arc 1: Three Become One. Morgan, Ethan and Ruby sit around a kitchen table with coffee in warm morning light.",
    "width": 1024,
    "height": 1536
  },
  "2": {
    "src": "/images/covers/arc-02-the-invisible-weight.webp",
    "alt": "Reflections, Arc 2: The Invisible Weight. Ethan sits with his hands clasped while Morgan stands by the window and Ruby sits beside a basket of laundry.",
    "width": 1024,
    "height": 1536
  },
  "3": {
    "src": "/images/covers/arc-03-fractured-reflections.webp",
    "alt": "Reflections, Arc 3: Fractured Reflections. A cracked mirror separates the reflections of Morgan, Ethan and Ruby as they look in different directions.",
    "width": 1024,
    "height": 1536
  },
  "4": {
    "src": "/images/covers/arc-04-the-choice.webp",
    "alt": "Reflections, Arc 4: The Choice. Morgan, Ethan and Ruby stand with space between them near their open front door, with daylight entering behind them.",
    "width": 1024,
    "height": 1536
  },
  "series": {
    "src": "/images/covers/reflections-cover.webp",
    "alt": "Reflections manga cover. Morgan, Ethan and Ruby stand together at a window at dusk, their reflections visible behind them.",
    "width": 1024,
    "height": 1536
  }
};

// Arc names, used by the reader when Next or Previous moves into another arc.
window.REFLECTIONS_ARCS = { 1: "Three Become One", 2: "The Invisible Weight", 3: "Fractured Reflections", 4: "The Choice" };

window.REFLECTIONS_CHAPTER_COVERS = {
  "001": {
    "src": "/images/covers/arc-01-chapter-01-three-hearts-different-needs.webp",
    "alt": "Reflections: Three Hearts, Different Needs. Ethan faces his reflection in a mirror while Ruby and Morgan watch from the kitchen.",
    "width": 1024,
    "height": 1536
  },
  "002": {
    "src": "/images/covers/arc-01-chapter-02-different-languages.webp",
    "alt": "Reflections: Different Languages. Morgan holds Ethan's shirt near the collar while Ruby rests her hand on his arm; the three are reflected in the window behind them.",
    "width": 1024,
    "height": 1536
  },
  "003": {
    "src": "/images/covers/arc-01-chapter-03-right-beside-you.webp",
    "alt": "Reflections: Right Beside You. Ethan and Ruby sit near one another on a sofa while Morgan knits in an armchair behind them.",
    "width": 1024,
    "height": 1536
  },
  "004": {
    "src": "/images/covers/arc-01-chapter-04-always-the-one-who-reaches.webp",
    "alt": "Reflections: Always the One Who Reaches. Ethan and Morgan sit on a sofa with their hands close but separate. Ruby stands behind them holding a mug.",
    "width": 1024,
    "height": 1536
  }
};

// End-of-chapter cards: shown as the last image of each chapter, after its story pages.
window.REFLECTIONS_CHAPTER_END_CARDS = {
  "001": {
    "src": "/images/covers/arc-01-chapter-01-end-three-hearts-different-needs.webp",
    "alt": "Ruby and Morgan lean against Ethan on either side as the three sit together at dusk. Text: “I know how to be needed. I’m still learning how to be myself.” End of Chapter 1: Three Hearts, Different Needs. Akira. To be continued.",
    "width": 1024,
    "height": 1536
  },
  "002": {
    "src": "/images/covers/arc-01-chapter-02-end-different-languages.webp",
    "alt": "Ruby and Morgan lean on a table on either side of Ethan, who talks with open hands. Text: “I thought I was showing you love. I didn’t realize you were still waiting to feel it.” End of Chapter 2: Different Languages. Akira. To be continued.",
    "width": 1024,
    "height": 1536
  },
  "003": {
    "src": "/images/covers/arc-01-chapter-03-end-right-beside-you.webp",
    "alt": "Ethan and Ruby sit apart on a sofa, glancing at each other, while Morgan reads in an armchair behind them. Text: “I missed you while you were sitting right beside me.” End of Chapter 3: Right Beside You. Akira. To be continued.",
    "width": 1024,
    "height": 1536
  },
  "004": {
    "src": "/images/covers/arc-01-chapter-04-end-always-the-one-who-reaches.webp",
    "alt": "Ethan and Morgan stand facing each other as their hands reach and almost touch, while Ruby sits on the sofa behind them holding a mug. Text: “I wanted you to reach for me. I didn’t know how to ask.” End of Chapter 4: Always the One Who Reaches. Akira. End of Arc 1.",
    "width": 1024,
    "height": 1536
  }
};

// Chapters available in the reader, including clearly marked cover previews.
// To publish pages: add page images under site/pages/chapter-001/ and list them here,
// each with descriptive alt text (what happens on the page, including dialogue).
//
// Example page entry:
//   { src: "pages/chapter-001/001.webp", alt: "Ethan stands alone in the kitchen at night...", width: 1200, height: 1700 }
//
// cast: character ids (as used on characters.html) who appear in the chapter.
// Each listed character's bio gets an "Appears in" link to this chapter.
window.REFLECTIONS_CHAPTERS = [
  {
    id: "001",
    arc: 1,
    opensArc: true,
    title: "Three Hearts, Different Needs",
    note: "Chapter 1 is being redrawn. The first page of the new version is up as an early look. More pages land here as they are finished.",
    cast: ["ethan-walker", "morgan-hayes", "ruby-bennett-walker", "rowan-hayes-walker", "riley-hayes-walker", "avery-bennett-walker"],
    // Version 2 retelling. Version 1 pages are hidden from the reader and kept in
    // site/pages/chapter-001/version_1/ (see index.json there).
    pages: [
      { src: "/pages/chapter-001/001.webp", alt: "An open photo album shows a wedding portrait in a cream pocket. Narration: \"Morgan, Ruby and Ethan on the day they were married.\" Morgan in a lace gown stands on the left, Ethan in a dark suit and pink tie in the middle, and Ruby in a lace gown and veil on the right. In the kitchen, Ruby opens the album on a low wooden cabinet, the wedding photo beside an empty pocket. Morgan points at the empty pocket: \"Saving this one for something?\" Ruby: \"For us. With the kids this time.\" Ruby looks up at Ethan, who smiles down at her: \"We should get one with all six of us before anybody grows another inch.\" Ethan holds up his phone to take a picture of Morgan and Ruby standing together: \"Okay, squeeze in.\" Ruby, one eyebrow raised: \"That means you too, Ethan.\"", width: 1024, height: 1536 }
    ]
  },
  {
    id: "002",
    arc: 1,
    title: "Different Languages",
    coverOnly: true,
    note: "Chapter cover preview. Story pages are coming soon.",
    cast: [],
    pages: []
  },
  {
    id: "003",
    arc: 1,
    title: "Right Beside You",
    coverOnly: true,
    note: "Chapter cover preview. Story pages are coming soon.",
    cast: [],
    pages: []
  },
  {
    id: "004",
    arc: 1,
    title: "Always the One Who Reaches",
    coverOnly: true,
    note: "Chapter cover preview. Story pages are coming soon.",
    cast: [],
    pages: []
  }
];

// Attach the opening covers before story pages and the end card after them, without renaming pages.
window.REFLECTIONS_CHAPTERS.forEach(function (chapter) {
  var covers = window.REFLECTIONS_COVERS;
  var opening = [];
  if (chapter.opensArc) {
    if (chapter.arc === 1) opening.push(covers.series);
    if (covers[chapter.arc]) opening.push(covers[chapter.arc]);
  }
  var chapterCover = window.REFLECTIONS_CHAPTER_COVERS[chapter.id];
  if (chapterCover) opening.push(chapterCover);
  var endCard = (window.REFLECTIONS_CHAPTER_END_CARDS || {})[chapter.id];
  chapter.pages = opening.concat(chapter.pages || [], endCard ? [endCard] : []);
});
