"use client";

import Link from "next/link";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";

export function Header() {
  return (
    <header className="flex items-center justify-between border-b border-white/10 px-6 py-4">
      <Link href="/" className="font-serif text-xl tracking-tight text-paper">
        Season
      </Link>
      <nav className="flex items-center gap-5 text-sm text-mute">
        <Link href="/" className="hover:text-paper">
          Vault
        </Link>
        <Link href="/season" className="hover:text-paper">
          Season
        </Link>
        <Link href="/admin" className="hover:text-paper">
          Admin
        </Link>
        <WalletMultiButton />
      </nav>
    </header>
  );
}
