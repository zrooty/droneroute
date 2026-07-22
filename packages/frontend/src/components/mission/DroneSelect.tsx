import { useMissionStore } from "@/store/missionStore";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DRONE_MODELS } from "@droneroute/shared";

// Drone/payload picker. Lives at the top of the sidebar because the chosen
// model drives GSD, photo interval and line spacing in grid overlap mode —
// it needs to be set before planning, not buried in mission settings.
export function DroneSelect() {
  const { config, setConfig } = useMissionStore();

  const selectedDrone = DRONE_MODELS.find(
    (d) =>
      d.droneEnumValue === config.droneEnumValue &&
      d.droneSubEnumValue === config.droneSubEnumValue,
  );

  return (
    <div className="flex flex-col gap-2 p-2 border-b border-border">
      <div>
        <Label className="text-xs">Drone model</Label>
        <Select
          value={`${config.droneEnumValue}-${config.droneSubEnumValue}`}
          onValueChange={(v) => {
            const [drone, sub] = v.split("-").map(Number);
            const model = DRONE_MODELS.find(
              (d) => d.droneEnumValue === drone && d.droneSubEnumValue === sub,
            );
            if (model) {
              setConfig({
                droneEnumValue: model.droneEnumValue,
                droneSubEnumValue: model.droneSubEnumValue,
                payloadEnumValue: model.payloads[0]?.payloadEnumValue || 0,
              });
            }
          }}
        >
          <SelectTrigger className="h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {DRONE_MODELS.map((d) => (
              <SelectItem
                key={`${d.droneEnumValue}-${d.droneSubEnumValue}`}
                value={`${d.droneEnumValue}-${d.droneSubEnumValue}`}
              >
                {d.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {selectedDrone && selectedDrone.payloads.length > 1 && (
        <div>
          <Label className="text-xs">Payload</Label>
          <Select
            value={String(config.payloadEnumValue)}
            onValueChange={(v) => setConfig({ payloadEnumValue: parseInt(v) })}
          >
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {selectedDrone.payloads.map((p) => (
                <SelectItem
                  key={p.payloadEnumValue}
                  value={String(p.payloadEnumValue)}
                >
                  {p.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
    </div>
  );
}
