import { useRef, useState } from "react";
import { Download, Upload, FileDown, MoreVertical, FileSpreadsheet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { parseSpreadsheet, toCSV, downloadCSV, downloadXLSX, csvTimestamp } from "@/lib/csv";

export interface ImportResult { inserted: number; skipped: number; errors: string[] }

interface Props {
  /** Plural entity name, e.g. "clients" */
  entity: string;
  /** Column order for the export + template files */
  columns: string[];
  /** Rows to export (already flattened) */
  exportRows: () => Promise<Record<string, unknown>[]>;
  /** Persist parsed CSV rows; return a per-row summary */
  onImport: (rows: Record<string, string>[]) => Promise<ImportResult>;
  onImported?: () => void;
}

export function ImportExport({ entity, columns, exportRows, onImport, onImported }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);

  const doExport = async () => {
    setBusy(true);
    try {
      const rows = await exportRows();
      if (!rows.length) { toast.info(`No ${entity} to export`); return; }
      downloadCSV(`${entity}-${csvTimestamp()}.csv`, toCSV(rows, columns));
      toast.success(`Exported ${rows.length} ${entity}`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally { setBusy(false); }
  };

  const doTemplate = () => downloadCSV(`${entity}-import-template.csv`, toCSV([], columns));

  const handleFile = async (file: File) => {
    setBusy(true);
    try {
      const rows = parseCSV(await file.text());
      if (!rows.length) { toast.error("The file has no data rows"); return; }
      const res = await onImport(rows);
      setResult(res);
      onImported?.();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <>
      <input
        ref={fileRef}
        type="file"
        accept=".csv,text/csv"
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
      />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" disabled={busy}>
            <MoreVertical className="h-4 w-4 mr-2" />{busy ? "Working…" : "Import / Export"}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel className="capitalize">{entity} data</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={doExport}><Download className="h-4 w-4 mr-2" />Export CSV</DropdownMenuItem>
          <DropdownMenuItem onClick={() => fileRef.current?.click()}><Upload className="h-4 w-4 mr-2" />Import CSV</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={doTemplate}><FileDown className="h-4 w-4 mr-2" />Download template</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={!!result} onOpenChange={(o) => !o && setResult(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle className="capitalize">{entity} import summary</DialogTitle></DialogHeader>
          <div className="space-y-3 text-sm">
            <div className="flex gap-6">
              <div><div className="text-muted-foreground text-xs">Imported</div><div className="text-2xl font-semibold text-success">{result?.inserted ?? 0}</div></div>
              <div><div className="text-muted-foreground text-xs">Skipped</div><div className="text-2xl font-semibold text-muted-foreground">{result?.skipped ?? 0}</div></div>
            </div>
            {!!result?.errors.length && (
              <div className="max-h-56 overflow-y-auto rounded-lg border border-border bg-muted/30 p-3 space-y-1">
                {result.errors.map((err, i) => (<div key={i} className="text-xs text-destructive">{err}</div>))}
              </div>
            )}
          </div>
          <DialogFooter><Button onClick={() => setResult(null)}>Done</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
