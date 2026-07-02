import { Document, Page, Text, View, StyleSheet, renderToBuffer } from "@react-pdf/renderer";

export type ReportSection = {
  titulo: string;
  filas: Record<string, string>[];
};

export type ReportParams = {
  titulo: string;
  subtitulo: string;
  secciones: ReportSection[];
};

const ESTADOS = ["TX", "FL", "CA"];

const styles = StyleSheet.create({
  page: { padding: 32, fontSize: 9, fontFamily: "Helvetica" },
  h1: { fontSize: 18, fontFamily: "Helvetica-Bold", marginBottom: 4 },
  subtitulo: { fontSize: 10, color: "#555555", marginBottom: 2 },
  fecha: { fontSize: 8, color: "#888888", marginBottom: 16 },
  sectionTitle: { fontSize: 13, fontFamily: "Helvetica-Bold", marginTop: 16, marginBottom: 8 },
  resumen: { fontSize: 9, color: "#333333", marginBottom: 10 },
  table: { display: "flex", width: "100%", borderStyle: "solid", borderWidth: 1, borderColor: "#dddddd" },
  row: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: "#eeeeee" },
  headerRow: {
    flexDirection: "row",
    backgroundColor: "#f4f4f4",
    borderBottomWidth: 1,
    borderBottomColor: "#dddddd",
  },
  cellEmpresa: { width: "20%", padding: 4, fontFamily: "Helvetica-Bold" },
  cellEstado: { width: "6%", padding: 4 },
  cellWeb: { width: "18%", padding: 4 },
  cellEmail: { width: "16%", padding: 4 },
  cellTelefono: { width: "12%", padding: 4 },
  cellCategoria: { width: "14%", padding: 4 },
  cellFuente: { width: "14%", padding: 4 },
  headerCell: { fontFamily: "Helvetica-Bold", fontSize: 8, color: "#333333" },
  empty: { padding: 8, fontStyle: "italic", color: "#888888" },
});

function contarPorEstado(filas: Record<string, string>[]): Record<string, number> {
  const conteo: Record<string, number> = {};
  for (const estado of ESTADOS) conteo[estado] = 0;
  for (const fila of filas) {
    const estado = (fila.state || "").toUpperCase();
    if (estado in conteo) conteo[estado]++;
  }
  return conteo;
}

function ReportDocument({ titulo, subtitulo, secciones }: ReportParams) {
  const generadoEl = new Date().toLocaleString("en-US", { dateStyle: "long", timeStyle: "short" });

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <Text style={styles.h1}>{titulo}</Text>
        <Text style={styles.subtitulo}>{subtitulo}</Text>
        <Text style={styles.fecha}>Generated: {generadoEl}</Text>

        {secciones.map((seccion, i) => {
          const conteo = contarPorEstado(seccion.filas);
          const resumenTexto = `Total: ${seccion.filas.length} · ${ESTADOS.map(
            (e) => `${e}: ${conteo[e]}`
          ).join(" · ")}`;

          return (
            <View key={i}>
              <Text style={styles.sectionTitle}>{seccion.titulo}</Text>
              <Text style={styles.resumen}>{resumenTexto}</Text>
              <View style={styles.table}>
                <View style={styles.headerRow}>
                  <Text style={[styles.cellEmpresa, styles.headerCell]}>Company</Text>
                  <Text style={[styles.cellEstado, styles.headerCell]}>State</Text>
                  <Text style={[styles.cellWeb, styles.headerCell]}>Website</Text>
                  <Text style={[styles.cellEmail, styles.headerCell]}>Email</Text>
                  <Text style={[styles.cellTelefono, styles.headerCell]}>Phone</Text>
                  <Text style={[styles.cellCategoria, styles.headerCell]}>Category</Text>
                  <Text style={[styles.cellFuente, styles.headerCell]}>Source</Text>
                </View>

                {seccion.filas.length === 0 ? (
                  <Text style={styles.empty}>No companies registered yet.</Text>
                ) : (
                  seccion.filas.map((fila, j) => (
                    <View key={j} style={styles.row}>
                      <Text style={styles.cellEmpresa}>{fila.company || "-"}</Text>
                      <Text style={styles.cellEstado}>{fila.state || "-"}</Text>
                      <Text style={styles.cellWeb}>{fila.website || "-"}</Text>
                      <Text style={styles.cellEmail}>{fila.email || "-"}</Text>
                      <Text style={styles.cellTelefono}>{fila.phone || "-"}</Text>
                      <Text style={styles.cellCategoria}>{fila.category || "-"}</Text>
                      <Text style={styles.cellFuente}>{fila.source || "-"}</Text>
                    </View>
                  ))
                )}
              </View>
            </View>
          );
        })}
      </Page>
    </Document>
  );
}

export async function generateReportPdf(params: ReportParams): Promise<Buffer> {
  return renderToBuffer(<ReportDocument {...params} />);
}
