import { useCallback, useEffect, useState } from "react";
import { useContract } from "./hooks/useContract";
import Header from "./components/Header";
import CampaignList from "./components/CampaignList";
import CreateCampaign from "./components/CreateCampaign";
import CampaignDetails from "./components/CampaignDetails";

const POLL_MS = 4000;

function toCampaign(id, c) {
  return {
    id,
    creator: c.creator,
    title: c.title,
    goal: c.goal,
    deadline: Number(c.deadline),
    totalRaised: c.totalRaised,
    released: c.released,
    milestoneCount: Number(c.milestoneCount),
    currentMilestone: Number(c.currentMilestone),
    state: Number(c.state),
  };
}

export default function App() {
  const wallet = useContract();
  const [view, setView] = useState({ name: "list" });
  const [campaigns, setCampaigns] = useState([]);
  const [now, setNow] = useState(Math.floor(Date.now() / 1000));
  const [version, setVersion] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  // Загружает все кампании и время блокчейна (на localhost время может быть сдвинуто)
  const load = useCallback(async () => {
    const { readContract, readProvider } = wallet;
    if (!readContract) return;
    try {
      const [count, block] = await Promise.all([readContract.campaignCount(), readProvider.getBlock("latest")]);
      const list = await Promise.all(
        Array.from({ length: Number(count) }, (_, i) => readContract.getCampaign(i).then((c) => toCampaign(i, c)))
      );
      setCampaigns(list.reverse());
      setNow((n) => Math.max(n, block.timestamp, Math.floor(Date.now() / 1000)));
      setLoadError("");
    } catch (e) {
      console.error(e);
      setLoadError(
        "Cannot read the contract. Is the node running and is frontend/src/contract/MilestoneFund.json up to date?"
      );
    } finally {
      setLoading(false);
      setVersion((v) => v + 1);
    }
  }, [wallet.readContract, wallet.readProvider]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    load();
    const t = setInterval(load, POLL_MS);
    return () => clearInterval(t);
  }, [load]);

  // На localhost время сети меняется скриптом advance-time, поэтому
  // локальные часы тикают от последнего известного времени блока
  useEffect(() => {
    const t = setInterval(() => setNow((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const selected = view.name === "details" ? campaigns.find((c) => c.id === view.id) : null;

  return (
    <>
      <Header wallet={wallet} onHome={() => setView({ name: "list" })} />
      <main className="container">
        {!wallet.hasWallet && (
          <div className="notice">MetaMask is not installed — you can browse campaigns, but not send transactions.</div>
        )}
        {loadError && <div className="notice notice-bad">{loadError}</div>}

        {view.name === "list" && (
          <CampaignList
            campaigns={campaigns}
            now={now}
            loading={loading}
            onOpen={(id) => setView({ name: "details", id })}
            onCreate={() => setView({ name: "create" })}
          />
        )}
        {view.name === "create" && (
          <CreateCampaign
            wallet={wallet}
            onCancel={() => setView({ name: "list" })}
            onCreated={async (id) => {
              await load();
              setView(id === null ? { name: "list" } : { name: "details", id });
            }}
          />
        )}
        {view.name === "details" && (
          <CampaignDetails
            wallet={wallet}
            campaign={selected}
            now={now}
            version={version}
            onBack={() => setView({ name: "list" })}
            onChanged={load}
          />
        )}
      </main>
      <footer className="footer muted small">
        Contract {wallet.address} · funds are released only after investors approve each milestone
      </footer>
    </>
  );
}
