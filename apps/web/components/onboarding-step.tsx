import { Check } from "lucide-react";
import { Card, CardBody } from "@/components/ui/card";

export function Step({
  n,
  title,
  description,
  active,
  done,
  children,
}: {
  n: number;
  title: string;
  description: string;
  active?: boolean;
  done?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <li>
      <Card className={active ? "border-accent/50" : "opacity-70"}>
        <CardBody className="flex gap-4">
          <span
            className={`flex size-7 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${
              done
                ? "bg-ok text-white"
                : active
                  ? "bg-accent text-accent-text"
                  : "bg-surface-muted text-muted"
            }`}
          >
            {done ? <Check className="size-4" /> : n}
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="font-semibold">{title}</h2>
            <p className="mt-0.5 text-sm text-muted">{description}</p>
            {children ? <div className="mt-4">{children}</div> : null}
          </div>
        </CardBody>
      </Card>
    </li>
  );
}
