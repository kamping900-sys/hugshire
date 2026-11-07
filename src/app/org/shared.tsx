import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/server/http";
import { defaultCtx } from "@/server/services/context";
import { myOrgs } from "@/server/services/orgs";
import { Badge, cx } from "@/components/ui";

export async function loadOrg(path: string) {
  const user = await currentUser();
  if (!user) redirect(`/login?next=${path}`);
  const ctx = await defaultCtx();
  const orgs = await myOrgs(ctx, user.id);
  return { user, ctx, org: orgs[0]?.org ?? null, role: orgs[0]?.role ?? null };
}

const TABS = [
  { href: "/org", label: "Overview" },
  { href: "/org/causes", label: "My causes" },
  { href: "/org/payouts", label: "Payouts" },
  { href: "/org/settings", label: "Settings" },
];

export function OrgNav({ active, orgName, status }: { active: string; orgName: string; status: string }) {
  return (
    <div className="mb-8">
      <div className="flex flex-wrap items-center gap-2">
        <div className="eyebrow">Organizer portal</div>
        <Badge tone={status === "approved" ? "leaf" : status === "pending" ? "butter" : "berry"}>{status === "approved" ? "Verified organisation" : status === "pending" ? "Awaiting review" : status}</Badge>
      </div>
      <h1 className="mt-2 text-3xl font-extrabold tracking-tight">{orgName}</h1>
      <nav className="mt-5 flex gap-1 overflow-x-auto rounded-2xl bg-paper p-1 shadow-[var(--shadow-soft)]">
        {TABS.map((t) => (
          <Link key={t.href} href={t.href} className={cx("whitespace-nowrap rounded-xl px-4 py-2 text-sm font-bold", active === t.href ? "bg-orange text-white" : "text-ink-soft hover:bg-orange-soft/50 hover:text-ink")}>
            {t.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
