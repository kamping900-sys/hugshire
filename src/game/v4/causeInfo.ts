/**
 * Cause profiles shown from the town's ⓘ button. Demo content for the sample organisations (they are
 * fictional and flagged is_sample in the database); real organisations will fill this in themselves.
 */
export type CauseProfile = {
  founded: number;
  basedIn: string;
  team: string;
  mission: string;
  goalUsd: number;
  raisedUsd: number;
  budget: { item: string; usd: number }[];
  impact: { icon: string; value: string; label: string }[];
  updates: { date: string; title: string; body: string }[];
  contact: string;
};

export const CAUSE_PROFILES: Record<string, CauseProfile> = {
  pawsbury: {
    founded: 2016,
    basedIn: "Pawsbury, at the end of Willow Lane",
    team: "4 staff · 38 volunteers",
    mission:
      "We take in abandoned and surrendered dogs and cats, get them healthy, and find them a home that fits. Nobody is turned away for being old, shy or expensive to treat.",
    goalUsd: 800,
    raisedUsd: 312,
    budget: [
      { item: "Insulated kennel panels (6)", usd: 360 },
      { item: "Washable winter bedding", usd: 180 },
      { item: "Safe ceramic heat lamps (4)", usd: 160 },
      { item: "Draught-proofing the cat room", usd: 100 },
    ],
    impact: [
      { icon: "🏡", value: "1,240", label: "animals rehomed" },
      { icon: "🩺", value: "96%", label: "leave healthy" },
      { icon: "🐾", value: "41", label: "in our care today" },
    ],
    updates: [
      { date: "Nov 3", title: "First kennel panels are in", body: "The two oldest kennels now hold heat through the night. Biscuit, our 12-year-old beagle, finally sleeps stretched out." },
      { date: "Oct 18", title: "Cold snap plan ready", body: "Volunteers mapped every draught in the building. The heat lamps go to the puppy room and the senior dogs first." },
      { date: "Oct 2", title: "Meet Juniper", body: "A shy tabby who arrived in September. She now greets volunteers at the door and is ready for a quiet home." },
    ],
    contact: "Open for visits Sat & Sun, 10am–3pm",
  },
  "inkwell-hollow": {
    founded: 2019,
    basedIn: "Inkwell Hollow Library, upstairs room",
    team: "2 staff · 25 volunteer readers",
    mission:
      "Many children in our town go home to houses with no books. We put a reading corner in every primary classroom and read with the children who need a little extra help.",
    goalUsd: 1500,
    raisedUsd: 640,
    budget: [
      { item: "Age-right books (120)", usd: 720 },
      { item: "Low shelves and book boxes", usd: 380 },
      { item: "Cushions and a reading rug", usd: 250 },
      { item: "Library cards for every child", usd: 150 },
    ],
    impact: [
      { icon: "📚", value: "14", label: "classrooms with a corner" },
      { icon: "🧒", value: "380", label: "children reading weekly" },
      { icon: "⭐", value: "+31%", label: "reading confidence" },
    ],
    updates: [
      { date: "Nov 6", title: "Corner #14 opened", body: "Ms Okafor's Year 2 class picked dinosaurs and space for their first box of books." },
      { date: "Oct 21", title: "Reading buddies return", body: "Our volunteers are back reading one-to-one on Tuesday and Thursday mornings." },
      { date: "Oct 7", title: "Thank you, Inkwell Bakery", body: "They donated the cushions for three classrooms." },
    ],
    contact: "Volunteer evenings every first Wednesday",
  },
  fernhollow: {
    founded: 2014,
    basedIn: "Riverside Gardens, Fernhollow",
    team: "1 coordinator · 60 family plots",
    mission:
      "Our riverside garden lets families without a yard grow fresh vegetables together. Spring floods washed most of it away; we're rebuilding it higher and stronger.",
    goalUsd: 1000,
    raisedUsd: 455,
    budget: [
      { item: "Raised beds above flood level (10)", usd: 500 },
      { item: "Shared tool shed and tools", usd: 260 },
      { item: "Seedlings and seed stock", usd: 140 },
      { item: "Water butts and drainage", usd: 100 },
    ],
    impact: [
      { icon: "🥕", value: "2.1 t", label: "vegetables grown last year" },
      { icon: "👨‍👩‍👧", value: "60", label: "families with a plot" },
      { icon: "🌱", value: "18", label: "beds rebuilt so far" },
    ],
    updates: [
      { date: "Nov 4", title: "Bed 18 is planted", body: "Garlic and winter onions went in this weekend. Twelve children helped plant the first row." },
      { date: "Oct 15", title: "New tool shed", body: "The shed is up on its new concrete base, well above the spring flood line." },
      { date: "Sep 30", title: "Seed swap", body: "Families swapped 400 packets of seeds saved from the plots that survived." },
    ],
    contact: "Garden open daily, sunrise to sunset",
  },
  "ladle-lane": {
    founded: 2012,
    basedIn: "Ladle Lane Community Kitchen",
    team: "3 cooks · 50 volunteers",
    mission:
      "Children who get free school lunches can go hungry at the weekend. Every Friday we send them home with healthy meals for Saturday and Sunday, packed quietly so no one is singled out.",
    goalUsd: 1200,
    raisedUsd: 790,
    budget: [
      { item: "Weekend meal kits (100)", usd: 800 },
      { item: "Fresh fruit and milk", usd: 220 },
      { item: "Reusable kit bags", usd: 120 },
      { item: "Fridge repair", usd: 60 },
    ],
    impact: [
      { icon: "🍲", value: "41,000", label: "meals since 2012" },
      { icon: "🎒", value: "210", label: "kits every Friday" },
      { icon: "🏫", value: "6", label: "partner schools" },
    ],
    updates: [
      { date: "Nov 7", title: "Soup season", body: "This week's kits include our lentil and carrot soup, the children's favourite." },
      { date: "Oct 24", title: "Sixth school joins", body: "Brookside Primary now sends 28 children home with a kit each Friday." },
      { date: "Oct 10", title: "Thursday packing team", body: "Volunteers packed 210 kits in under two hours. Thank you!" },
    ],
    contact: "Packing nights every Thursday, 6–8pm",
  },
};
