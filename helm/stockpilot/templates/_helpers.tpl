{{/*
The single source of names, labels, images, database env and security contexts, so a Service,
selector or Ingress backend can never point at a name that does not exist.
Helpers that take a component are called with (dict "root" $ "component" "<name>").
*/}}

{{/* Base name: the release name (stockpilot) unless fullnameOverride is set. */}}
{{- define "stockpilot.fullname" -}}
{{- .Values.fullnameOverride | default .Release.Name | trunc 40 | trimSuffix "-" -}}
{{- end -}}

{{/* <fullname>-<component>, e.g. stockpilot-backend. */}}
{{- define "stockpilot.componentName" -}}
{{- printf "%s-%s" (include "stockpilot.fullname" .root) .component -}}
{{- end -}}

{{/* Immutable selector labels. */}}
{{- define "stockpilot.selectorLabels" -}}
app.kubernetes.io/name: stockpilot
app.kubernetes.io/instance: {{ .root.Release.Name }}
app.kubernetes.io/component: {{ .component }}
{{- end -}}

{{/* Selector labels plus the chart, version and ownership labels. */}}
{{- define "stockpilot.labels" -}}
{{ include "stockpilot.selectorLabels" . }}
helm.sh/chart: {{ printf "%s-%s" .root.Chart.Name .root.Chart.Version | replace "+" "_" }}
{{- /* Quoted: a 7-character SHA can be all digits. */}}
app.kubernetes.io/version: {{ .root.Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .root.Release.Service }}
app.kubernetes.io/part-of: stockpilot
{{- end -}}

{{/* "<repository>:<tag>"; an empty tag falls back to .Chart.AppVersion. Called with (dict "root" $ "image" <image values>). */}}
{{- define "stockpilot.image" -}}
{{- printf "%s:%s" .image.repository (.image.tag | default .root.Chart.AppVersion | toString) -}}
{{- end -}}

{{/*
Database env for the backend, the migrate Job and nothing else. DATABASE_URL must come last:
$(VAR) only expands variables defined earlier in the same list. The passwords are hex, so the
URL needs no escaping.
*/}}
{{- define "stockpilot.dbEnv" -}}
{{- $secret := .Values.postgres.existingSecret -}}
- name: DB_USER
  valueFrom:
    secretKeyRef: {name: {{ $secret }}, key: username}
- name: DB_PASSWORD
  valueFrom:
    secretKeyRef: {name: {{ $secret }}, key: password}
- name: DB_NAME
  valueFrom:
    secretKeyRef: {name: {{ $secret }}, key: database}
- name: DATABASE_URL
  value: "postgresql+psycopg://$(DB_USER):$(DB_PASSWORD)@{{ include "stockpilot.componentName" (dict "root" . "component" "postgres") }}:5432/$(DB_NAME)"
{{- end -}}

{{/* Pod securityContext for a non-root image; called with the numeric uid. */}}
{{- define "stockpilot.podSecurityContext" -}}
runAsNonRoot: true
runAsUser: {{ . }}
runAsGroup: {{ . }}
seccompProfile:
  type: RuntimeDefault
{{- end -}}

{{/* Container securityContext that satisfies Pod Security "restricted". */}}
{{- define "stockpilot.containerSecurityContext" -}}
allowPrivilegeEscalation: false
readOnlyRootFilesystem: true
capabilities:
  drop: ["ALL"]
{{- end -}}
