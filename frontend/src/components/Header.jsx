import { shortAddr } from "../utils";

const NETWORKS = { 31337: "Hardhat Local", 11155111: "Sepolia" };

export default function Header({ wallet, onHome }) {
  const { hasWallet, account, chainId, wrongNetwork, expectedChainId, connect, switchNetwork } = wallet;
  return (
    <header className="header">
      <button className="logo" onClick={onHome}>
        <span className="logo-mark">◆</span> MilestoneFund
      </button>
      <div className="header-right">
        {chainId !== null && (
          <span className={`badge ${wrongNetwork ? "badge-bad" : "badge-ok"}`}>
            {NETWORKS[chainId] || `Chain ${chainId}`}
          </span>
        )}
        {!hasWallet ? (
          <a className="btn" href="https://metamask.io/download/" target="_blank" rel="noreferrer">
            Install MetaMask
          </a>
        ) : wrongNetwork ? (
          <button className="btn btn-warn" onClick={switchNetwork}>
            Switch to {NETWORKS[expectedChainId] || expectedChainId}
          </button>
        ) : account ? (
          <span className="account">{shortAddr(account)}</span>
        ) : (
          <button className="btn btn-primary" onClick={connect}>
            Connect wallet
          </button>
        )}
      </div>
    </header>
  );
}
