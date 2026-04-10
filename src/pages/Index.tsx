import { motion } from 'framer-motion';
import { ArrowRight, BookText, Database, Eye, Layers3, ScanSearch, Search, ShieldCheck, Sparkles, Zap } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const featureCards = [
  {
    icon: ScanSearch,
    title: 'Understands scanned PDFs',
    body: 'Runs Tesseract worker pools in the browser when native PDF text is missing or weak.',
  },
  {
    icon: Layers3,
    title: 'Recovers layout structure',
    body: 'Separates columns, side regions, and headings so reading order survives messy source pages.',
  },
  {
    icon: Database,
    title: 'Stays local and offline',
    body: 'Projects, pages, thumbnails, and extracted text persist in IndexedDB without a server round trip.',
  },
  {
    icon: Search,
    title: 'Turns OCR into a workspace',
    body: 'Search completed pages, reopen saved projects, and export clean text or structured JSON.',
  },
];

const workflow = [
  'Drop in a PDF and create a local project.',
  'Extract native text first, then OCR only where needed.',
  'Rebuild reading order from token geometry and region analysis.',
  'Search, review, and export the finished text.',
];

const stats = [
  { value: '0', label: 'servers required' },
  { value: 'PDF.js + Tesseract', label: 'browser processing stack' },
  { value: 'TXT / JSON / Print', label: 'export formats' },
];

const Index = () => (
  <main className="min-h-screen overflow-hidden landing-grid text-foreground">
    <section className="relative isolate">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(0,163,255,0.22),transparent_30%),radial-gradient(circle_at_80%_20%,rgba(255,122,0,0.18),transparent_28%),linear-gradient(180deg,rgba(255,255,255,0.78),rgba(247,248,252,0.94))]" />
      <div className="absolute inset-x-0 top-0 h-[34rem] landing-noise opacity-40" />

      <div className="relative mx-auto flex min-h-screen max-w-7xl flex-col px-6 pb-16 pt-6 sm:px-8 lg:px-10">
        <header className="glass flex items-center justify-between rounded-full px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-foreground text-background shadow-lg">
              <Eye className="h-5 w-5" />
            </div>
            <div>
              <div className="landing-kicker">LOCAL OCR PRO</div>
              <div className="text-sm text-muted-foreground">Document recovery for difficult PDFs</div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button asChild variant="ghost" size="sm" className="hidden sm:inline-flex">
              <a href="#features">Features</a>
            </Button>
            <Button asChild size="sm" className="gradient-primary text-primary-foreground shadow-glow">
              <Link to="/app">
                Open Workspace
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
          </div>
        </header>

        <div className="grid flex-1 items-center gap-14 py-12 lg:grid-cols-[1.08fr_0.92fr] lg:py-16">
          <div className="max-w-3xl">
            <motion.div
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6 }}
              className="inline-flex items-center gap-2 rounded-full border border-foreground/10 bg-white/70 px-4 py-2 text-xs font-semibold uppercase tracking-[0.24em] text-foreground/70 backdrop-blur"
            >
              <Sparkles className="h-3.5 w-3.5 text-primary" />
              Browser-native OCR pipeline
            </motion.div>

            <motion.h1
              initial={{ opacity: 0, y: 28 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.08, duration: 0.65 }}
              className="font-editorial mt-6 max-w-4xl text-balance text-5xl font-semibold leading-[0.95] tracking-[-0.04em] text-slate-950 sm:text-6xl lg:text-7xl"
            >
              Pull readable structure out of PDFs that were never meant to cooperate.
            </motion.h1>

            <motion.p
              initial={{ opacity: 0, y: 28 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.16, duration: 0.65 }}
              className="mt-6 max-w-2xl text-lg leading-8 text-slate-700 sm:text-xl"
            >
              Local OCR Pro extracts native text when it can, switches to OCR when it must,
              rebuilds columns and headings, and keeps the whole workflow inside the browser.
            </motion.p>

            <motion.div
              initial={{ opacity: 0, y: 28 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.24, duration: 0.65 }}
              className="mt-8 flex flex-col gap-3 sm:flex-row"
            >
              <Button asChild size="lg" className="gradient-primary h-12 rounded-full px-7 text-primary-foreground shadow-glow">
                <Link to="/app">
                  Launch OCR Workspace
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
              <Button asChild variant="outline" size="lg" className="h-12 rounded-full border-foreground/15 bg-white/70 px-7 backdrop-blur">
                <a href="#workflow">See How It Works</a>
              </Button>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 28 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.32, duration: 0.65 }}
              className="mt-10 grid gap-4 sm:grid-cols-3"
            >
              {stats.map((stat) => (
                <div key={stat.label} className="rounded-3xl border border-white/70 bg-white/72 p-4 shadow-[0_20px_50px_-24px_rgba(15,23,42,0.35)] backdrop-blur">
                  <div className="text-sm uppercase tracking-[0.24em] text-slate-500">{stat.label}</div>
                  <div className="mt-3 text-2xl font-semibold tracking-[-0.04em] text-slate-950">{stat.value}</div>
                </div>
              ))}
            </motion.div>
          </div>

          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ delay: 0.15, duration: 0.7 }}
            className="relative"
          >
            <div className="absolute -left-10 top-12 hidden h-32 w-32 rounded-full bg-cyan-300/45 blur-3xl lg:block" />
            <div className="absolute -right-6 bottom-10 hidden h-40 w-40 rounded-full bg-orange-300/50 blur-3xl lg:block" />

            <div className="relative overflow-hidden rounded-[2rem] border border-slate-900/10 bg-slate-950 p-5 text-slate-100 shadow-[0_40px_120px_-40px_rgba(15,23,42,0.7)]">
              <div className="absolute inset-0 bg-[linear-gradient(140deg,rgba(2,6,23,0.92),rgba(15,23,42,0.82)_44%,rgba(12,74,110,0.48))]" />
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(56,189,248,0.18),transparent_28%),radial-gradient(circle_at_80%_70%,rgba(251,146,60,0.16),transparent_26%)]" />

              <div className="relative">
                <div className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
                  <div>
                    <div className="landing-kicker text-white/60">Live pipeline</div>
                    <div className="mt-1 text-lg font-semibold">From scanned page to structured text</div>
                  </div>
                  <div className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3 py-1 text-xs text-emerald-200">
                    OCR Ready
                  </div>
                </div>

                <div className="mt-5 grid gap-4">
                  {[
                    { label: 'Input', value: 'Native PDFs + image-only scans', accent: 'from-sky-400/25 to-sky-500/5' },
                    { label: 'Analysis', value: 'Text extraction, token geometry, column recovery', accent: 'from-fuchsia-400/25 to-fuchsia-500/5' },
                    { label: 'Output', value: 'Searchable text, JSON export, print-friendly review', accent: 'from-amber-300/25 to-amber-500/5' },
                  ].map((item, index) => (
                    <div
                      key={item.label}
                      className={cn(
                        'rounded-2xl border border-white/10 bg-gradient-to-br p-4',
                        item.accent
                      )}
                    >
                      <div className="text-xs uppercase tracking-[0.24em] text-white/55">{String(index + 1).padStart(2, '0')} {item.label}</div>
                      <div className="mt-2 text-base font-medium leading-7 text-white/92">{item.value}</div>
                    </div>
                  ))}
                </div>

                <div className="mt-5 grid gap-4 sm:grid-cols-2">
                  <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                    <div className="flex items-center gap-2 text-sm text-white/70">
                      <ShieldCheck className="h-4 w-4 text-emerald-300" />
                      Data stays in-browser
                    </div>
                    <p className="mt-3 text-sm leading-7 text-white/82">
                      IndexedDB stores projects, page metadata, and OCR output without requiring an upload pipeline.
                    </p>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                    <div className="flex items-center gap-2 text-sm text-white/70">
                      <Zap className="h-4 w-4 text-cyan-300" />
                      Parallel worker pool
                    </div>
                    <p className="mt-3 text-sm leading-7 text-white/82">
                      Native extraction is attempted first, then OCR workers process only the pages that truly need it.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      </div>
    </section>

    <section id="features" className="relative mx-auto max-w-7xl px-6 py-24 sm:px-8 lg:px-10">
      <div className="max-w-2xl">
        <div className="landing-kicker">Why it feels different</div>
        <h2 className="font-editorial mt-4 text-4xl font-semibold tracking-[-0.04em] text-slate-950 sm:text-5xl">
          More than OCR. It is a local document reconstruction tool.
        </h2>
        <p className="mt-5 text-lg leading-8 text-slate-700">
          The project is designed for PDFs that mix clean digital text, scanned pages, and awkward multi-column layouts.
        </p>
      </div>

      <div className="mt-12 grid gap-5 md:grid-cols-2 xl:grid-cols-4">
        {featureCards.map((feature, index) => {
          const Icon = feature.icon;
          return (
            <motion.div
              key={feature.title}
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.3 }}
              transition={{ delay: index * 0.06, duration: 0.45 }}
              className="group rounded-[1.75rem] border border-slate-200 bg-white/80 p-6 shadow-[0_24px_80px_-42px_rgba(15,23,42,0.38)] backdrop-blur transition-transform hover:-translate-y-1"
            >
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-950 text-white shadow-lg">
                <Icon className="h-5 w-5" />
              </div>
              <h3 className="mt-5 text-xl font-semibold text-slate-950">{feature.title}</h3>
              <p className="mt-3 text-sm leading-7 text-slate-600">{feature.body}</p>
            </motion.div>
          );
        })}
      </div>
    </section>

    <section id="workflow" className="mx-auto max-w-7xl px-6 pb-24 sm:px-8 lg:px-10">
      <div className="grid gap-8 rounded-[2rem] border border-slate-200 bg-[linear-gradient(180deg,rgba(255,255,255,0.92),rgba(241,245,249,0.96))] p-8 shadow-[0_30px_100px_-50px_rgba(15,23,42,0.45)] lg:grid-cols-[0.9fr_1.1fr] lg:p-10">
        <div>
          <div className="landing-kicker">Workflow</div>
          <h2 className="font-editorial mt-4 text-4xl font-semibold tracking-[-0.04em] text-slate-950">
            Built for the actual OCR review loop.
          </h2>
          <p className="mt-5 text-base leading-8 text-slate-700">
            The user journey is simple on the surface, but the pipeline underneath is tuned for low-friction recovery of useful text.
          </p>

          <div className="mt-8 rounded-[1.5rem] bg-slate-950 p-6 text-white">
            <div className="flex items-center gap-3 text-sm uppercase tracking-[0.24em] text-white/55">
              <BookText className="h-4 w-4 text-amber-300" />
              Product intent
            </div>
            <p className="mt-4 text-lg leading-8 text-white/88">
              Fast native extraction when possible. OCR fallback when necessary. Layout recovery so the result is readable instead of merely extracted.
            </p>
          </div>
        </div>

        <div className="grid gap-4">
          {workflow.map((step, index) => (
            <motion.div
              key={step}
              initial={{ opacity: 0, x: 20 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true, amount: 0.3 }}
              transition={{ delay: index * 0.08, duration: 0.45 }}
              className="flex gap-4 rounded-[1.5rem] border border-slate-200 bg-white p-5"
            >
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-slate-950 text-sm font-semibold text-white">
                {index + 1}
              </div>
              <p className="pt-1 text-base leading-8 text-slate-700">{step}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>

    <section className="mx-auto max-w-7xl px-6 pb-24 sm:px-8 lg:px-10">
      <div className="rounded-[2rem] border border-slate-200 bg-slate-950 px-8 py-10 text-white shadow-[0_30px_120px_-50px_rgba(15,23,42,0.82)] lg:px-10">
        <div className="flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-2xl">
            <div className="landing-kicker text-white/55">Start here</div>
            <h2 className="font-editorial mt-4 text-4xl font-semibold tracking-[-0.04em] text-white sm:text-5xl">
              Open the workspace and run the OCR pipeline on your own documents.
            </h2>
            <p className="mt-5 text-lg leading-8 text-white/72">
              No setup wizard, no backend dashboard, no cloud dependency. Just the workspace.
            </p>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row">
            <Button asChild size="lg" className="gradient-primary h-12 rounded-full px-7 text-primary-foreground shadow-glow">
              <Link to="/app">
                Enter Workspace
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
            <Button asChild variant="outline" size="lg" className="h-12 rounded-full border-white/15 bg-white/5 px-7 text-white hover:bg-white/10 hover:text-white">
              <a href="#features">Review Features</a>
            </Button>
          </div>
        </div>
      </div>
    </section>
  </main>
);

export default Index;
