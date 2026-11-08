/**
 * DEMO DATA ONLY. Fictional causes for the world-map prototype. Clearly labelled in the UI.
 * The real app passes causes from the database in the same `WorldCause` shape.
 */
import { causeSlots, hash2, type Category, type WorldCause } from "./gen";

const NAMES: Record<Category, [string, string][]> = {
  square: [["Hugshire Town Square", "Community hub"]],
  animals: [["Care Hill", "Animal welfare"], ["Whisker Way", "Cat rescue"], ["Paw Meadow", "Dog shelter"], ["Burrow Bend", "Small animal care"], ["Feather Rest", "Bird sanctuary"]],
  food: [["Hope Fields", "Community farm"], ["Ladle Lane", "Weekend meal kits"], ["Harvest Row", "Food bank"], ["Seedling Patch", "School gardens"], ["Bread Basket", "Bakery for all"]],
  health: [["Wellness Grove", "Health & wellbeing"], ["Calm Waters", "Mental health"], ["Sunny Clinic", "Free check-ups"], ["Gentle Pines", "Elder care"], ["Kind Hearts", "Hospital visits"]],
  education: [["Learning Lane", "Education & opportunity"], ["Inkwell Hollow", "Library corners"], ["Bright Pages", "Reading club"], ["Chalk Corner", "After-school tutoring"], ["Starlit School", "Science kits"]],
  arts: [["Kindred Arts", "Creativity & inclusion"], ["Palette Park", "Art therapy"], ["Melody Mews", "Music lessons"], ["Clay Cove", "Pottery for all"]],
  community: [["Giving Harbor", "Volunteers & donations"], ["Lantern Quay", "Disaster relief"], ["Anchor Point", "Refugee welcome"], ["Shell Shore", "Beach clean-up"]],
  nature: [["Greenway Park", "Nature & community"], ["Fernhollow", "Riverside garden"], ["Mossy Glen", "Tree planting"], ["Dewdrop Dell", "Pollinator meadow"]],
  homes: [["Hometown", "Housing support"], ["Hearth Hollow", "Warm homes"], ["Doorstep Row", "First homes"], ["Cozy Commons", "Shelter beds"]],
};

const ORGS = ["Willowbrook Trust", "Kindling Foundation", "Little Lantern Co-op", "Open Door Society", "Meadowlark Fund", "Bramble & Bee", "Northstar Friends"];
const ORDER: Category[] = ["animals", "food", "health", "education", "arts", "community", "nature", "homes"];

export function demoCauses(n = 64): WorldCause[] {
  const slots = causeSlots(n);
  const used: Record<string, number> = {};
  return slots.map((p, i) => {
    const category: Category = i === 0 ? "square" : ORDER[(i - 1 + Math.floor(hash2(i, 1) * 3)) % ORDER.length];
    const list = NAMES[category];
    const k = (used[category] = (used[category] ?? -1) + 1);
    const [base, subtitle] = list[k % list.length];
    const name = k < list.length ? base : `${base} ${Math.floor(k / list.length) + 1}`;
    const h = hash2(p.x, p.y, 5);
    const stage = i === 0 ? 5 : Math.min(5, Math.floor(h * 6.5));
    return {
      id: `demo-${i}`,
      name,
      subtitle,
      org: ORGS[i % ORGS.length],
      category,
      tx: p.x,
      ty: p.y,
      stage,
      helpers: Math.floor(4 + h * 120),
      deliveredUsd: Math.round(stage * stage * 37 * (0.6 + h) * 100) / 100,
    };
  });
}
