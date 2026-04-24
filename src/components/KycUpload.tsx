import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Upload, FileText, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";

export function KycUpload({ customerId }: { customerId: string }) {
  const { user, hasRole } = useAuth();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [docType, setDocType] = useState("National ID");
  const [isId, setIsId] = useState(true);
  const isAdmin = hasRole("admin") || hasRole("super_admin");

  const { data: docs = [] } = useQuery({
    queryKey: ["kyc", customerId],
    queryFn: async () => {
      const { data } = await supabase.from("kyc_documents").select("*").eq("customer_id", customerId).order("uploaded_at", { ascending: false });
      return data ?? [];
    },
  });

  const upload = useMutation({
    mutationFn: async (file: File) => {
      const path = `${customerId}/${Date.now()}_${file.name}`;
      const { error: upErr } = await supabase.storage.from("kyc-documents").upload(path, file);
      if (upErr) throw upErr;
      const { error } = await supabase.from("kyc_documents").insert({
        customer_id: customerId, doc_type: docType, storage_path: path, is_id_document: isId, uploaded_by: user!.id,
      });
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Document uploaded"); qc.invalidateQueries({ queryKey: ["kyc", customerId] }); if (fileRef.current) fileRef.current.value = ""; },
    onError: (e: Error) => toast.error(e.message),
  });

  const del = useMutation({
    mutationFn: async (d: { id: string; storage_path: string }) => {
      await supabase.storage.from("kyc-documents").remove([d.storage_path]);
      const { error } = await supabase.from("kyc_documents").delete().eq("id", d.id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Removed"); qc.invalidateQueries({ queryKey: ["kyc", customerId] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const view = async (path: string) => {
    const { data } = await supabase.storage.from("kyc-documents").createSignedUrl(path, 60);
    if (data?.signedUrl) window.open(data.signedUrl, "_blank");
  };

  const hasId = docs.some((d) => d.is_id_document);

  return (
    <div className="space-y-3">
      {!hasId && <div className="text-xs text-warning-foreground bg-warning/15 px-3 py-2 rounded">⚠ ID document required for KYC</div>}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label className="text-xs">Document type</Label>
          <Input value={docType} onChange={(e) => setDocType(e.target.value)} className="h-8" />
        </div>
        <div className="flex items-end gap-2">
          <Checkbox checked={isId} onCheckedChange={(v) => setIsId(!!v)} id="isid" />
          <Label htmlFor="isid" className="text-xs">This is an ID document</Label>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Input type="file" ref={fileRef} onChange={(e) => { const f = e.target.files?.[0]; if (f) upload.mutate(f); }} className="h-8" />
        <Button size="sm" variant="outline" disabled><Upload className="h-3 w-3" /></Button>
      </div>
      <div className="space-y-1">
        {docs.map((d) => (
          <div key={d.id} className="flex items-center gap-2 text-sm border border-border rounded px-2 py-1">
            <FileText className="h-3.5 w-3.5 text-muted-foreground" />
            <button type="button" className="flex-1 text-left truncate hover:underline" onClick={() => view(d.storage_path)}>{d.doc_type}</button>
            {d.is_id_document && <span className="text-[10px] bg-primary-soft text-primary px-1.5 py-0.5 rounded">ID</span>}
            {isAdmin && (
              <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => del.mutate({ id: d.id, storage_path: d.storage_path })}>
                <Trash2 className="h-3 w-3" />
              </Button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
