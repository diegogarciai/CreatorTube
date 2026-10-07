export function Prose({ children }: { children: React.ReactNode }) {
  return (
    <article className="mx-auto max-w-3xl px-6 py-12 text-[15px] leading-7 [&_h1]:text-3xl [&_h1]:font-semibold [&_h2]:mt-8 [&_h2]:text-lg [&_h2]:font-semibold [&_li]:ml-5 [&_li]:list-disc [&_p]:mt-3 [&_ul]:mt-3 [&_a]:text-accent [&_a]:underline">
      {children}
    </article>
  );
}
