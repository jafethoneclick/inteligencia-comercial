import { getRows, SHEET_TABS } from "@/lib/google-sheets";
import { CompanyTable } from "@/components/company-table";
import { ResearchForm } from "@/components/research-form";
import { ReportForm } from "@/components/report-form";
import { ChatPanel } from "@/components/chat-panel";

// Siempre trae datos frescos de Sheets, no cachea la página.
export const dynamic = "force-dynamic";

export default async function Home() {
  let proveedores: Awaited<ReturnType<typeof getRows>> = [];
  let clientes: Awaited<ReturnType<typeof getRows>> = [];
  let error: string | null = null;

  try {
    [proveedores, clientes] = await Promise.all([
      getRows(SHEET_TABS.proveedores),
      getRows(SHEET_TABS.clientesPotenciales),
    ]);
  } catch (e) {
    error = e instanceof Error ? e.message : "Error desconocido al leer Google Sheets";
  }

  return (
    <div className="flex flex-1 flex-col bg-zinc-50 dark:bg-black">
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-6 py-10">
        <header className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            Inteligencia Comercial — Artículos Deportivos
          </h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Proveedores y clientes potenciales en Texas, Florida y California, sincronizados
            con Google Sheets.
          </p>
        </header>

        {error ? (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
            No se pudo conectar con Google Sheets: {error}
          </div>
        ) : (
          <>
            <ChatPanel />
            <ResearchForm />
            <ReportForm />
            <CompanyTable proveedores={proveedores} clientes={clientes} />
          </>
        )}
      </main>
    </div>
  );
}
