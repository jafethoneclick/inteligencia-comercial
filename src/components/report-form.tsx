"use client";

import { useState } from "react";

const ESTADOS = ["TX", "FL", "CA"] as const;

export function ReportForm() {
  const [tipo, setTipo] = useState<"proveedores" | "clientes" | "ambos">("ambos");
  const [estados, setEstados] = useState<string[]>([...ESTADOS]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggleEstado(estado: string) {
    setEstados((prev) =>
      prev.includes(estado) ? prev.filter((e) => e !== estado) : [...prev, estado]
    );
  }

  async function handleGenerar() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tipo, estados }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || `Error ${res.status}`);
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `reporte-${new Date().toISOString().slice(0, 10)}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error de red");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
      <h2 className="mb-3 text-sm font-semibold text-zinc-800 dark:text-zinc-200">
        Reporte profesional (PDF)
      </h2>
      <div className="flex flex-wrap items-center gap-3">
        <select
          value={tipo}
          onChange={(e) => setTipo(e.target.value as "proveedores" | "clientes" | "ambos")}
          className="rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
        >
          <option value="ambos">Proveedores y clientes</option>
          <option value="proveedores">Solo proveedores</option>
          <option value="clientes">Solo clientes potenciales</option>
        </select>

        <div className="flex gap-2">
          {ESTADOS.map((estado) => (
            <label
              key={estado}
              className={`cursor-pointer rounded-full border px-3 py-1 text-xs font-medium ${
                estados.includes(estado)
                  ? "border-black bg-black text-white dark:border-white dark:bg-white dark:text-black"
                  : "border-zinc-300 text-zinc-600 dark:border-zinc-700 dark:text-zinc-400"
              }`}
            >
              <input
                type="checkbox"
                className="hidden"
                checked={estados.includes(estado)}
                onChange={() => toggleEstado(estado)}
              />
              {estado}
            </label>
          ))}
        </div>

        <button
          type="button"
          onClick={handleGenerar}
          disabled={loading || estados.length === 0}
          className="rounded-full bg-black px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-800 disabled:opacity-50 dark:bg-white dark:text-black dark:hover:bg-zinc-200"
        >
          {loading ? "Generando..." : "Generar reporte PDF"}
        </button>
      </div>

      {error && (
        <div className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          Error: {error}
        </div>
      )}
    </div>
  );
}
