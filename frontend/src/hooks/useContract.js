import { useCallback, useEffect, useMemo, useState } from "react";
import { BrowserProvider, Contract, JsonRpcProvider } from "ethers";
import deployment from "../contract/MilestoneFund.json";

const RPC_FALLBACK = { 31337: "http://127.0.0.1:8545" };

/** MetaMask connection, current account, network and contract instances. */
export function useContract() {
  const [account, setAccount] = useState(null);
  const [chainId, setChainId] = useState(null);
  const [signer, setSigner] = useState(null);
  const hasWallet = typeof window !== "undefined" && !!window.ethereum;

  const browserProvider = useMemo(() => (hasWallet ? new BrowserProvider(window.ethereum) : null), [hasWallet]);

  // Read provider: MetaMask on the right network, otherwise a direct RPC (for localhost)
  const readProvider = useMemo(() => {
    if (browserProvider && chainId === deployment.chainId) return browserProvider;
    const url = RPC_FALLBACK[deployment.chainId];
    return url ? new JsonRpcProvider(url) : browserProvider;
  }, [browserProvider, chainId]);

  const readContract = useMemo(
    () => (readProvider ? new Contract(deployment.address, deployment.abi, readProvider) : null),
    [readProvider]
  );
  const writeContract = useMemo(
    () => (signer ? new Contract(deployment.address, deployment.abi, signer) : null),
    [signer]
  );

  const sync = useCallback(async () => {
    if (!browserProvider) return;
    const net = await browserProvider.getNetwork();
    setChainId(Number(net.chainId));
    const accounts = await browserProvider.send("eth_accounts", []);
    if (accounts.length) {
      setAccount(accounts[0]);
      setSigner(await browserProvider.getSigner(accounts[0]));
    } else {
      setAccount(null);
      setSigner(null);
    }
  }, [browserProvider]);

  const connect = useCallback(async () => {
    if (!browserProvider) return;
    await browserProvider.send("eth_requestAccounts", []);
    await sync();
  }, [browserProvider, sync]);

  const switchNetwork = useCallback(async () => {
    const hex = "0x" + deployment.chainId.toString(16);
    try {
      await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hex }] });
    } catch (e) {
      if (e.code === 4902 && deployment.chainId === 31337) {
        await window.ethereum.request({
          method: "wallet_addEthereumChain",
          params: [
            {
              chainId: hex,
              chainName: "Hardhat Localhost",
              rpcUrls: ["http://127.0.0.1:8545"],
              nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
            },
          ],
        });
      } else throw e;
    }
  }, []);

  useEffect(() => {
    if (!hasWallet) return;
    sync();
    // Reload the page when the network changes (recommended by MetaMask)
    const onChain = () => window.location.reload();
    const onAccounts = () => sync();
    window.ethereum.on("accountsChanged", onAccounts);
    window.ethereum.on("chainChanged", onChain);
    return () => {
      window.ethereum.removeListener("accountsChanged", onAccounts);
      window.ethereum.removeListener("chainChanged", onChain);
    };
  }, [hasWallet, sync]);

  return {
    hasWallet,
    account,
    chainId,
    expectedChainId: deployment.chainId,
    wrongNetwork: chainId !== null && chainId !== deployment.chainId,
    connect,
    switchNetwork,
    readContract,
    writeContract,
    readProvider,
    address: deployment.address,
  };
}
