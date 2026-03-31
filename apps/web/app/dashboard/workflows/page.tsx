"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { PageHeader } from "../../../components/page-header";
import { StatsCard } from "../../../components/stats-card";
import { readPlatformSession, type PlatformSession } from "../../../lib/platform-auth";
import {
  fetchN8nExecutions,
  fetchN8nWorkflows,
  fetchProviders,
  type N8nExecution,
  type N8nWorkflow
} from "../../../lib/platform-api";

export default function WorkflowsPage() {
  const router = useRouter();
  const [session, setSession] = useState<PlatformSession | null>(null);
  const [workflows, setWorkflows] = useState<N8nWorkflow[]>([]);
  const [executions, setExecutions] = useState<N8nExecution[]>([]);
  const [selectedWorkflowId, setSelectedWorkflowId] = useState("");
  const [n8nConnected, setN8nConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [executionsLoading, setExecutionsLoading] = useState(true);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    const storedSession = readPlatformSession();
    if (!storedSession) {
      router.replace("/auth/login");
      return;
    }

    setSession(storedSession);
  }, [router]);

  useEffect(() => {
    async function load() {
      if (!session) {
        return;
      }

      setLoading(true);
      setExecutionsLoading(true);
      setNotice("");

      try {
        const providersPayload = await fetchProviders(session);
        const n8nProvider = providersPayload.providers.find((provider) => provider.provider === "n8n");
        const connected = Boolean(n8nProvider?.connected);
        setN8nConnected(connected);

        if (!connected) {
          setWorkflows([]);
          setExecutions([]);
          setNotice("Connect n8n in the Connectors page and save the API URL plus bearer token before workflow data can load.");
          return;
        }

        const workflowsPayload = await fetchN8nWorkflows(session);
        setWorkflows(workflowsPayload.workflows);

        const firstWorkflowId = workflowsPayload.workflows[0]?.id ?? "";
        setSelectedWorkflowId((current) => current || firstWorkflowId);

        const executionsPayload = await fetchN8nExecutions(firstWorkflowId || undefined, session);
        setExecutions(executionsPayload.executions);
      } catch (error) {
        setNotice(error instanceof Error ? error.message : "Could not load n8n workflows.");
      } finally {
        setLoading(false);
        setExecutionsLoading(false);
      }
    }

    void load();
  }, [session]);

  useEffect(() => {
    async function loadExecutions() {
      if (!session || !selectedWorkflowId || !n8nConnected) {
        return;
      }

      setExecutionsLoading(true);

      try {
        const payload = await fetchN8nExecutions(selectedWorkflowId, session);
        setExecutions(payload.executions);
      } catch (error) {
        setNotice(error instanceof Error ? error.message : "Could not load workflow executions.");
      } finally {
        setExecutionsLoading(false);
      }
    }

    void loadExecutions();
  }, [selectedWorkflowId, session, n8nConnected]);

  const workflowMetrics = useMemo(() => {
    const activeCount = workflows.filter((workflow) => workflow.active).length;
    const failedCount = executions.filter((execution) => execution.status.toLowerCase().includes("error") || execution.status.toLowerCase().includes("fail")).length;
    return {
      total: workflows.length,
      active: activeCount,
      executions: executions.length,
      failed: failedCount
    };
  }, [executions, workflows]);

  return (
    <div className="stack">
      <PageHeader
        eyebrow="Automation"
        title="n8n workflows"
        description="Inspect the live n8n workflow catalogue and execution history using the API credentials saved in this tenant."
      />

      {notice ? <div className="notice">{notice}</div> : null}

      <div className="stats-row">
        <StatsCard value={loading ? "..." : workflowMetrics.total} label="Workflows" />
        <StatsCard value={loading ? "..." : workflowMetrics.active} label="Active workflows" />
        <StatsCard value={executionsLoading ? "..." : workflowMetrics.executions} label="Recent executions" />
        <StatsCard value={executionsLoading ? "..." : workflowMetrics.failed} label="Failed runs" />
      </div>

      <section className="grid two">
        <article className="panel stack">
          <div className="section-heading">
            <div>
              <span className="eyebrow">Workflow List</span>
              <h2>Available workflows</h2>
            </div>
          </div>

          {!n8nConnected ? (
            <div className="empty-state">
              <h3>n8n is not connected</h3>
              <p>Save your n8n API URL and bearer token in Connectors, then link the workspace.</p>
            </div>
          ) : (
            <div className="permission-list">
              {workflows.map((workflow) => (
                <button
                  key={workflow.id}
                  type="button"
                  className={`permission-item workflow-row ${selectedWorkflowId === workflow.id ? "selected" : ""}`}
                  onClick={() => setSelectedWorkflowId(workflow.id)}
                >
                  <div>
                    <strong>{workflow.name}</strong>
                    <p>{workflow.tags.length ? workflow.tags.join(", ") : "No tags"} · Updated {new Date(workflow.updatedAt).toLocaleString()}</p>
                  </div>
                  <span className={`status-pill ${workflow.active ? "connected" : "disconnected"}`}>
                    {workflow.active ? "Active" : "Inactive"}
                  </span>
                </button>
              ))}
            </div>
          )}
        </article>

        <article className="panel stack">
          <div className="section-heading">
            <div>
              <span className="eyebrow">Execution History</span>
              <h2>{selectedWorkflowId ? `Workflow ${selectedWorkflowId}` : "Recent runs"}</h2>
            </div>
          </div>

          {executionsLoading ? (
            <div className="panel">Loading executions...</div>
          ) : executions.length === 0 ? (
            <div className="empty-state">
              <h3>No executions found</h3>
              <p>The selected workflow has not returned any runs through the n8n API yet.</p>
            </div>
          ) : (
            <div className="data-table-wrapper">
              <table>
                <thead>
                  <tr>
                    <th>Execution</th>
                    <th>Status</th>
                    <th>Mode</th>
                    <th>Started</th>
                    <th>Stopped</th>
                  </tr>
                </thead>
                <tbody>
                  {executions.map((execution) => (
                    <tr key={execution.id}>
                      <td>{execution.id}</td>
                      <td><span className={`status-pill ${execution.status.toLowerCase()}`}>{execution.status}</span></td>
                      <td>{execution.mode}</td>
                      <td>{new Date(execution.startedAt).toLocaleString()}</td>
                      <td>{execution.stoppedAt ? new Date(execution.stoppedAt).toLocaleString() : "Running"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </article>
      </section>
    </div>
  );
}
