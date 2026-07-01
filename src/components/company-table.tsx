"use client";

import { useMemo, useState } from "react";

type CompanyRow = Record<string, string>;

export function CompanyTable({
  proveedores,
  clientes,
}: {
  proveedores: CompanyRow[];
  clientes: CompanyRow[];
}) {
  const [tab, setTab] = useState<"proveedores" | "clientes">("proveedores");
  const [query, setQuery] = useState("");

  const rows = tab === "proveedores" ? proveedores : clientes;

  const filteredRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((row) =>
      Object.values(row).some((value) => value.toLowerCase().includes(q))
    );
  }, [rows, query]);

  return (
    <div className="flex w-full flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-2">
          <TabButton active={tab === "proveedores"} onClick={() => setTab("proveedores")}>
            Proveedores ({proveedores.length})
          </TabButton>
          <TabButton active={tab === "clientes"} onClick={() => setTab("clientes")}>
            Clientes potenciales ({clientes.length})
          </TabButton>
        </div>
        <input
          type="text"
          placeholder="Buscar por nombre, estado, email..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="w-full max-w-xs rounded-md border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900"
        />
      </div>

      <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
        <table className="w-full min-w-[900px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-zinc-200 bg-zinc-50 text-left dark:border-zinc-800 dark:bg-zinc-900">
              <Th>Empresa</Th>
              <Th>Estado</Th>
              <Th>Sitio web</Th>
              <Th>Email</Th>
              <Th>Teléfono</Th>
              <Th>Redes sociales</Th>
              <Th>Categoría</Th>
              <Th>Dirección</Th>
              <Th>Fuente</Th>
              <Th>Última actualización</Th>
              <Th>Mapa</Th>
            </tr>
          </thead>
          <tbody>
            {filteredRows.length === 0 ? (
              <tr>
                <td colSpan={11} className="px-4 py-8 text-center text-zinc-500">
                  No hay empresas todavía. Corre una búsqueda manual para empezar a llenar
                  esta lista.
                </td>
              </tr>
            ) : (
              filteredRows.map((row) => (
                <tr
                  key={row.id || row.empresa}
                  className="border-b border-zinc-100 last:border-0 dark:border-zinc-900"
                >
                  <Td className="font-medium">{row.empresa}</Td>
                  <Td>{row.estado}</Td>
                  <Td>
                    {row.sitio_web ? (
                      <a
                        href={row.sitio_web}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 hover:underline dark:text-blue-400"
                      >
                        {row.sitio_web}
                      </a>
                    ) : (
                      "-"
                    )}
                  </Td>
                  <Td>{row.email || "-"}</Td>
                  <Td>{row.telefono || "-"}</Td>
                  <Td>{row.redes_sociales || "-"}</Td>
                  <Td>{row.categoria || "-"}</Td>
                  <Td>{row.direccion || "-"}</Td>
                  <Td>{row.fuente || "-"}</Td>
                  <Td>{row.ultima_actualizacion || "-"}</Td>
                  <Td>
                    {row.google_maps_url ? (
                      <a
                        href={row.google_maps_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 hover:underline dark:text-blue-400"
                      >
                        Ver en Maps
                      </a>
                    ) : (
                      "-"
                    )}
                  </Td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full px-4 py-2 text-sm font-medium transition-colors ${
        active
          ? "bg-black text-white dark:bg-white dark:text-black"
          : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800"
      }`}
    >
      {children}
    </button>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="px-4 py-3 font-semibold text-zinc-600 dark:text-zinc-400">{children}</th>;
}

function Td({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-4 py-3 text-zinc-800 dark:text-zinc-200 ${className}`}>{children}</td>;
}
