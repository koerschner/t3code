// Ag fork: the Settings › General row for Single workspace mode (singleWorkspace.ts).
import { Switch } from "../components/ui/switch";
import { SettingsRow } from "../components/settings/settingsLayout";
import { setSingleWorkspace, useSingleWorkspace } from "./singleWorkspace";

export function SingleWorkspaceSetting() {
  const on = useSingleWorkspace();
  return (
    <SettingsRow
      title="Single workspace"
      description="Hide project, environment and model details. For one project, one environment and one harness."
      control={
        <Switch
          checked={on}
          onCheckedChange={(c) => setSingleWorkspace(Boolean(c))}
          aria-label="Single workspace"
        />
      }
    />
  );
}
