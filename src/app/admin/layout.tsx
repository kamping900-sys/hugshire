import { notFound, redirect } from "next/navigation";
import { currentUser } from "@/server/http";
import { AdminNav } from "./AdminNav";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  if (!user) redirect("/login?next=/admin");
  if (user.role !== "admin") notFound();
  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="eyebrow">Hugshire operations</div>
          <h1 className="text-2xl font-extrabold tracking-tight">Admin</h1>
        </div>
        <form action="/admin" className="w-full sm:w-80">
          <input name="q" className="field" placeholder="Search users, orgs, causes, ids, tx hashes" aria-label="Search" />
        </form>
      </div>
      <AdminNav />
      <div className="mt-6">{children}</div>
    </div>
  );
}
