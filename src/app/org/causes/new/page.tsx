import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Card } from "@/components/ui";
import { ApiForm } from "@/components/ApiForm";
import { CATEGORY_OPTIONS } from "@/lib/categories";
import { loadOrg, OrgNav } from "../../shared";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "New cause" };


export default async function NewCause() {
  const { org } = await loadOrg("/org/causes/new");
  if (!org) redirect("/org");
  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <OrgNav active="/org/causes" orgName={org.name} status={org.status} />
      <Card className="max-w-2xl p-6">
        <h2 className="text-xl font-extrabold">New cause</h2>
        <p className="mt-1 text-sm text-ink-soft">It starts as a draft. When you&apos;re happy, submit it for review.</p>
        <div className="mt-6">
          <ApiForm
            path={`/api/org/${org.id}/causes`}
            submitLabel="Create draft"
            redirectToResult={{ key: "cause.id", prefix: "/org/causes/" }}
            fields={[
              { name: "cityName", label: "Town name", required: true, maxLength: 40, placeholder: "e.g. Pawsbury", hint: "The name of your town on the Hugshire map." },
              { name: "title", label: "Cause title", required: true, maxLength: 80, placeholder: "e.g. Shelter beds for winter" },
              { name: "summary", label: "One-line summary", required: true, maxLength: 200 },
              { name: "category", label: "Category", type: "select", options: CATEGORY_OPTIONS, defaultValue: "community" },
              { name: "description", label: "Full description", type: "textarea", maxLength: 5000, hint: "What will support be used for? Be specific; supporters read this." },
              { name: "goalUsd", label: "Symbolic goal (USD of yield)", type: "number", defaultValue: "1000", hint: "Paces how quickly the town grows. It is not a fundraising target." },
            ]}
          />
        </div>
      </Card>
    </div>
  );
}
