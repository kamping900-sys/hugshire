import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Badge, Card, Notice } from "@/components/ui";
import { ApiForm } from "@/components/ApiForm";
import { loadOrg, OrgNav } from "../shared";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Organisation settings" };

export default async function OrgSettings() {
  const { org, role } = await loadOrg("/org/settings");
  if (!org) redirect("/org");
  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <OrgNav active="/org/settings" orgName={org.name} status={org.status} />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="p-6">
          <h3 className="font-extrabold">Organisation profile</h3>
          {role !== "owner" && <p className="mt-2 text-sm text-ink-soft">Only the owner can change settings.</p>}
          <div className="mt-4">
            <ApiForm
              path={`/api/org/${org.id}`}
              method="PUT"
              submitLabel="Save"
              fields={[
                { name: "contactEmail", label: "Contact email", type: "email", defaultValue: org.contactEmail },
                { name: "website", label: "Website", type: "url", defaultValue: org.website ?? "" },
                { name: "description", label: "About", type: "textarea", defaultValue: org.description, maxLength: 2000 },
              ]}
            />
          </div>
        </Card>
        <Card className="p-6">
          <div className="flex items-center gap-2">
            <h3 className="font-extrabold">Receiving account</h3>
            {org.payoutVerifiedAt ? <Badge tone="leaf">Verified</Badge> : org.payoutNearAccount ? <Badge tone="butter">Awaiting verification</Badge> : <Badge tone="ink">Not set</Badge>}
          </div>
          <p className="mt-2 text-sm text-ink-soft">
            Payouts are sent in USDC on NEAR to an account your organisation controls. If you don&apos;t have one, Hugshire support will help you create one and cash out to your bank. Changing it pauses payouts until Hugshire verifies the new account.
          </p>
          <div className="mt-4">
            <ApiForm
              path={`/api/org/${org.id}`}
              method="PUT"
              submitLabel="Save receiving account"
              fields={[{ name: "payoutNearAccount", label: "NEAR account", defaultValue: org.payoutNearAccount ?? "", placeholder: "yourorg.near", maxLength: 64 }]}
            />
          </div>
          <div className="mt-4">
            <Notice tone="sky">Hugshire will contact you at {org.contactEmail} to confirm this account before it is added to the Vault&apos;s list of approved recipients.</Notice>
          </div>
        </Card>
      </div>
    </div>
  );
}
