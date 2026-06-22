export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return (
    <article className="mx-auto max-w-3xl rounded-2xl border border-white/10 bg-slate-900/70 p-6 text-sm leading-7 text-slate-300 shadow-xl shadow-black/20 ring-1 ring-white/5 sm:p-8">
      {children}
    </article>
  );
}
