import { PageHeader } from "../../../components/page-header";
import { WorkspaceConsole } from "../../../components/workspace-console";

export default function ConnectorsPage() {
  return (
    <div className="stack">
      <PageHeader
        eyebrow="Customer Workspace"
        title="Connected products"
        description="Manage tenant integrations, onboarding flows, and safe AI tool exposure from a single workspace."
      />
      <WorkspaceConsole />
    </div>
  );
}
