"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

const ESTADOS = ["TX", "FL", "CA"] as const;

type ResultSummary = {
  ok: boolean;
  nuevos?: number;
  actualizados?: number;
  totalEncontrados?: number;
  invalidos?: { company: string; issues: string[] }[];
  error?: string;
};

export function ResearchForm() {
  const router = useRouter();
  const [tipo, setTipo] = useState<"proveedores" | "clientes">("proveedores");
  const [estados, setEstados] = useState<string[]>([...ESTADOS]);
  const [criterios, setCriterios] = useState("");
  const [cantidad, setCantidad] = useState(6);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ResultSummary | null>(null);

  function toggleEstado(estado: string) {
    setEstados((prev) =>
      prev.includes(estado) ? prev.filter((e) => e !== estado) : [...prev, estado]
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch("/api/research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tipo, estados, criterios: criterios || undefined, cantidad }),
      });
      const data: ResultSummary = await res.json();
      setResult(data);
      if (data.ok) router.refresh();
    } catch (err) {
      setResult({ ok: false, error: err instanceof Error ? err.message : "Network error" });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
      <h2 className="mb-3 text-sm font-semibold text-zinc-800 dark:text-zinc-200">
        Manual search
      </h2>
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <select
            value={tipo}
            onChange={(e) => setTipo(e.target.value as "proveedores" | "clientes")}
            className="rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          >
            <option value="proveedores">Suppliers</option>
            <option value="clientes">Potential customers (baseball)</option>
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

          <input
            type="number"
            min={1}
            max={1200}
            value={cantidad}
            onChange={(e) => setCantidad(Number(e.target.value))}
            className="w-24 rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
            title="Number of companies to search (higher values take longer)"
          />
        </div>

        <input
          type="text"
          placeholder='Optional criteria, e.g. "soccer ball manufacturers"'
          value={criterios}
          onChange={(e) => setCriterios(e.target.value)}
          className="rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
        />

        <button
          type="submit"
          disabled={loading || estados.length === 0}
          className="self-start rounded-full bg-gradient-to-r from-orange-500 to-amber-500 px-5 py-2 text-sm font-medium text-white transition-all duration-300 hover:scale-105 hover:from-orange-600 hover:to-amber-600 hover:shadow-lg hover:shadow-orange-500/25 disabled:opacity-50 disabled:hover:scale-100"
        >
          {loading ? "Searching... (this can take a few minutes)" : "Search now"}
        </button>
      </form>

      {result && (
        <div
          className={`mt-3 rounded-md px-3 py-2 text-sm ${
            result.ok
              ? "bg-green-50 text-green-800 dark:bg-green-950 dark:text-green-300"
              : "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300"
          }`}
        >
          {result.ok ? (
            <>
              Found {result.totalEncontrados} · New: {result.nuevos} · Updated:{" "}
              {result.actualizados}
              {result.invalidos && result.invalidos.length > 0 && (
                <div className="mt-1 text-xs opacity-80">
                  Discarded during validation: {result.invalidos.map((i) => i.company).join(", ")}
                </div>
              )}
            </>
          ) : (
            <>Error: {result.error}</>
          )}
        </div>
      )}
    </div>
  );
}
