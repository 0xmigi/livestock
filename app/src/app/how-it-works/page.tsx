import type { Metadata } from "next";
import Link from "next/link";

import { Shell } from "@/components/shell";
import { StepFrame } from "@/components/step-frame";

export const metadata: Metadata = {
  title: "How it works",
  description: "What a narrative is, what happens on the date, and the questions people ask.",
};

/**
 * The guide. Four steps, the three fixed numbers, then the questions. Short
 * sentences, and nothing the program does not enforce. In particular the
 * price is a function of supply, so it moves both ways: never say a buy
 * always costs more than the last one.
 */

const STEPS = [
  {
    n: "00",
    title: "Pick a narrative",
    body: "A story about a company: a launch, a ruling, a number. Find one people are already talking about, and the stock it moves.",
  },
  {
    n: "01",
    title: "Launch a token",
    body: "Name it, pick the stock it converts to, and set the date. One transaction builds the token and its vault. You take 1% of every buy.",
  },
  {
    n: "02",
    title: "Buy or sell",
    body: "Buys are paid in SOL, swapped for the stock and locked in the vault. The price follows supply: buys push it up, sells push it down. Selling before the date costs a 10% exit tax that stays in the vault.",
  },
  {
    n: "03",
    title: "Expire into stock",
    body: "On the date, trading stops. The vault is split across every token and sent to holders. Nothing to claim.",
  },
];

const FAQ: { q: string; a: React.ReactNode }[] = [
  {
    q: "What am I holding?",
    a: "A token that is a claim on the narrative's vault. The vault holds real tokenised stock. At the end, each token is paid its share of the vault in that stock.",
  },
  {
    q: "What is a tokenised stock?",
    a: "A token on Solana backed one to one by a real share, from a regulated issuer. TSLAx is Tesla, NVDAx is Nvidia, and so on.",
  },
  {
    q: "How is the price set?",
    a: "By supply, on the same curve pump.fun uses, priced in the stock instead of SOL. Every narrative has a billion tokens, 793.1 million of them for sale on the curve, and opens at the same market cap as a pump.fun launch. Buys mint tokens and move the price up. Sells burn them and move it down. The curve is set at creation and never changes.",
  },
  {
    q: "What are the fees?",
    a: (
      <>
        The creator takes <strong className="font-medium text-neutral-900">1%</strong> of every buy. Selling before the
        date costs a <strong className="font-medium text-neutral-900">10%</strong> exit tax. That tax goes to no one. It
        stays in the vault for the holders left at the end.
      </>
    ),
  },
  {
    q: "Do I have to do anything on the date?",
    a: "No. A keeper closes trading and sends the stock to every holder, a few at a time. It takes a few minutes.",
  },
  {
    q: "What if the story is wrong?",
    a: "The same thing happens. A narrative is not a yes-or-no bet. It always turns into the stock on the date. The story only drives the trading in between.",
  },
  {
    q: "Can the creator take the money?",
    a: "No. The creator picks the stock, the story and the date, and takes the 1% fee. They cannot touch the vault, move the date, change the curve or mint tokens. The program enforces this.",
  },
  {
    q: "How long does a narrative run?",
    a: "One hour to two weeks, chosen at creation.",
  },
  {
    q: "Where does my SOL go?",
    a: "It is swapped for the stock in the same transaction and deposited in the vault. Nothing inside a narrative is held in SOL. Dollar figures on the site are the stock's live price times what is on chain.",
  },
  {
    q: "What do I need?",
    a: (
      <>
        A wallet with some SOL. Sign in, pick a narrative, buy. To launch one, go to{" "}
        <Link href="/create" className="text-link hover:underline">
          Create
        </Link>
        .
      </>
    ),
  },
];

export default function HowItWorks() {
  return (
    <Shell>
      <div className="space-y-12">
        <div className="max-w-2xl">
          <h1 className="display text-3xl text-neutral-900 sm:text-4xl">How it works</h1>
          <p className="mt-3 text-base leading-relaxed text-neutral-400">
            Buy a story about a company. Trade it. On the date, it turns into the stock.
          </p>
        </div>

        <section className="grid gap-2 sm:grid-cols-2">
          {STEPS.map((s, i) => (
            <div key={s.n} className="rounded bg-neutral-50 p-5">
              <div className="flex items-baseline gap-2">
                <span className="mono text-xs font-semibold text-accent">{s.n}</span>
                <span className="text-[15px] font-semibold text-neutral-900">{s.title}</span>
              </div>
              <p className="mt-2.5 text-sm leading-relaxed text-neutral-400">{s.body}</p>
              {/* The same example as the home page, stopped at this step. */}
              <div className="mt-5">
                <StepFrame step={i as 0 | 1 | 2 | 3} />
              </div>
            </div>
          ))}
        </section>

        <section className="rounded bg-neutral-50 p-2">
          <div className="mono px-3 pb-2.5 pt-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-neutral-400">
            The numbers
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            <Fact figure="1%" label="Creator fee" sub="on every buy" />
            <Fact figure="10%" label="Exit tax" sub="on sells, stays in the vault" />
            <Fact figure="1h – 2w" label="Lifetime" sub="set at creation" />
          </div>
        </section>

        <section id="faq" className="scroll-mt-8">
          <h2 className="display text-2xl text-neutral-900">Questions</h2>
          <div className="mt-4 space-y-2">
            {FAQ.map((item) => (
              <details key={item.q} className="group rounded bg-neutral-50 open:bg-neutral-50">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 text-[15px] font-medium text-neutral-900 transition-colors hover:bg-hover [&::-webkit-details-marker]:hidden">
                  {item.q}
                  <span className="mono shrink-0 text-neutral-400 transition-transform group-open:rotate-45">+</span>
                </summary>
                <div className="px-5 pb-5 text-sm leading-relaxed text-neutral-600">{item.a}</div>
              </details>
            ))}
          </div>
        </section>
      </div>
    </Shell>
  );
}

function Fact({ figure, label, sub }: { figure: string; label: string; sub: string }) {
  return (
    <div className="rounded bg-neutral-100 px-4 py-4">
      <div className="mono text-2xl font-semibold text-neutral-900">{figure}</div>
      <div className="mt-1 text-sm font-medium text-neutral-900">{label}</div>
      <div className="text-xs text-neutral-400">{sub}</div>
    </div>
  );
}
