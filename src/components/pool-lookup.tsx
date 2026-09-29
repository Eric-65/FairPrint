"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function PoolLookup({
  symbols,
  examples,
  initialAddress = "",
  initialRef = "",
}: {
  symbols: string[];
  examples: readonly { address: string; pair: string; ref: string | null }[];
  initialAddress?: string;
  initialRef?: string;
}) {
  const router = useRouter();
  const [address, setAddress] = useState(initialAddress);
  const [ref, setRef] = useState(initialRef);
  const open = (target: string, reference: string | null) =>
    router.push(`/launch/pool/${encodeURIComponent(target.trim())}${reference ? `?ref=${encodeURIComponent(reference)}` : ""}`);

  return (
    <div className="pool-lookup">
      <form
        className="launch-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (address.trim()) open(address, ref || null);
        }}
      >
        <label className="pool-lookup__address">
          DBC pool address
          <input value={address} onChange={(event) => setAddress(event.target.value)} placeholder="Paste a Meteora DBC pool address" spellCheck={false} />
        </label>
        <label>
          Fair value from
          <select value={ref} onChange={(event) => setRef(event.target.value)}>
            <option value="">No reference</option>
            {symbols.map((symbol) => <option key={symbol} value={symbol}>{symbol.replace(/x$/, "")} share price</option>)}
          </select>
        </label>
        <button type="submit" className="pool-lookup__go">Read pool</button>
      </form>
      <p className="watchlist-note">
        Stock-quoted DBC pools already on mainnet:{" "}
        {examples.map((example, index) => (
          <span key={example.address}>
            {index ? " · " : ""}
            <a href={`/launch/pool/${example.address}${example.ref ? `?ref=${example.ref}` : ""}`}>{example.pair}</a>
          </span>
        ))}
      </p>
    </div>
  );
}
