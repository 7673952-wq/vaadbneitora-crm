import { createFileRoute, Link } from "@tanstack/react-router";
import { useMyCrms } from "@/lib/use-crms";
import { LayoutDashboard, Construction } from "lucide-react";

export const Route = createFileRoute("/_authenticated/c/$crm")({
  component: CrmHome,
});

function CrmHome() {
  const { crm } = Route.useParams();
  const { data: crms } = useMyCrms();
  const current = crms?.find((c) => c.key === crm);

  if (crm === "yemot") {
    return (
      <div className="rounded-xl border border-border bg-card p-6">
        <Link to="/dashboard" className="text-primary underline">מעבר לדשבורד ימות המשיח</Link>
      </div>
    );
  }

  return (
    <div dir="rtl" className="space-y-4">
      <div
        className="rounded-xl border border-border p-6"
        style={{ background: `linear-gradient(90deg, ${current?.color ?? "#2563eb"}18, transparent)` }}
      >
        <h1 className="text-xl font-semibold flex items-center gap-2">
          <LayoutDashboard className="h-5 w-5" />
          {current?.name ?? crm}
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          מזהה הפניה במערכת זו: {current?.idLabel ?? "מספר מערכת"}
        </p>
      </div>
      <div className="rounded-xl border border-dashed border-border bg-card p-8 text-center text-muted-foreground">
        <Construction className="h-6 w-6 mx-auto mb-2" />
        המערכת הוקמה. שלב הבא: בניית טבלת הפניות והשדות המותאמים ל"{current?.name ?? crm}".
      </div>
    </div>
  );
}
