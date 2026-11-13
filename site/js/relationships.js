// Relationships shown in each character's bio on the Characters page.
//
// One line per relationship: { type, people, note }
//   type   - the label shown, e.g. "Married to", "Kids", "Siblings", "Friend", "Rival"
//   people - character ids (they become links that open that bio) or plain names
//            for someone who doesn't have a bio yet
//   note   - optional; shown after the names. Start it with "," or ";" to attach it directly.
// Entries with the same type are joined on one row, in the order listed.
//
// Example of adding a friend later:
//   { type: "Friend", people: ["Jordan"], note: "(Ruby's friend from ballet)" },
window.REFLECTIONS_RELATIONSHIPS = {
  "ethan-walker": [
    { type: "Married to", people: ["morgan-hayes", "ruby-bennett-walker"], note: ", in one shared ceremony with Ethan between them" },
    { type: "Kids", people: ["rowan-hayes-walker", "riley-hayes-walker"], note: "with Morgan" },
    { type: "Kids", people: ["avery-bennett-walker"], note: "with Ruby" },
    { type: "Closest to", people: ["avery-bennett-walker"] }
  ],
  "morgan-hayes": [
    { type: "Married to", people: ["ethan-walker"], note: ", in a shared ceremony with Ruby" },
    { type: "Kids", people: ["rowan-hayes-walker", "riley-hayes-walker"] },
    { type: "Also mom to", people: ["avery-bennett-walker"] },
    { type: "Best friend", people: ["ruby-bennett-walker"], note: "(co-parent, not a romantic partner)" },
    { type: "Closest to", people: ["riley-hayes-walker"] }
  ],
  "ruby-bennett-walker": [
    { type: "Married to", people: ["ethan-walker"], note: ", in a shared ceremony with Morgan" },
    { type: "Kids", people: ["avery-bennett-walker"] },
    { type: "Also mom to", people: ["rowan-hayes-walker", "riley-hayes-walker"] },
    { type: "Best friend", people: ["morgan-hayes"], note: "(co-parent, not a romantic partner)" },
    { type: "Closest to", people: ["rowan-hayes-walker"] }
  ],
  "rowan-hayes-walker": [
    { type: "Parents", people: ["ethan-walker", "morgan-hayes"] },
    { type: "Also his mom", people: ["ruby-bennett-walker"] },
    { type: "Siblings", people: ["riley-hayes-walker"], note: "(full sister)" },
    { type: "Siblings", people: ["avery-bennett-walker"], note: "(half-sister through Ethan)" },
    { type: "Closest to", people: ["ruby-bennett-walker"] }
  ],
  "riley-hayes-walker": [
    { type: "Parents", people: ["ethan-walker", "morgan-hayes"] },
    { type: "Also her mom", people: ["ruby-bennett-walker"] },
    { type: "Siblings", people: ["rowan-hayes-walker"], note: "(full brother)" },
    { type: "Siblings", people: ["avery-bennett-walker"], note: "(half-sister through Ethan)" },
    { type: "Closest to", people: ["morgan-hayes"] }
  ],
  "avery-bennett-walker": [
    { type: "Parents", people: ["ethan-walker", "ruby-bennett-walker"] },
    { type: "Also her mom", people: ["morgan-hayes"] },
    { type: "Siblings", people: ["rowan-hayes-walker", "riley-hayes-walker"], note: "(half-siblings through Ethan)" },
    { type: "Closest to", people: ["ethan-walker"] }
  ]
};
