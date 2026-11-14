/**
 * 「更新 CLI」 page. Values follow the confirmed design (proto.css) and doc/settings-ui-design.md:
 * rows 16/16, 32px brand icon top-aligned 6px down, 12px icon gap, 44px expansion indent,
 * 0.5px separators, md/sm native Buttons only. Section, heading and row text reuse settingsStyles.
 */
export const cliUpdateStyles = `
.cwn-update-page{--cwn-update-mono:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
.cwn-update-page .cwn-copy{margin-top:0}
.cwn-update-page .cwn-cli-identity>.cwn-settings-cli-name,.cwn-update-page .cwn-cli-identity>.cwn-settings-cli-name>div{min-width:0}
.cwn-update-tools{display:flex;flex-direction:column;align-items:flex-end;gap:4px;flex-shrink:0;max-width:60%}
.cwn-update-tools-row{display:flex;align-items:center;gap:var(--cwn-settings-action-gap);flex-wrap:nowrap}
.cwn-update-tools button{white-space:nowrap}
.cwn-update-page-error{flex-basis:100%;margin:0;text-align:right;font-size:var(--cwn-settings-description-size);line-height:var(--cwn-settings-feedback-line);color:var(--dsw-alias-state-error-primary);overflow-wrap:anywhere}
.cwn-update-section .cwn-settings-section-head h3{display:flex;align-items:center;gap:6px}
.cwn-update-count{color:var(--dsw-alias-label-tertiary);font-weight:var(--cwn-settings-label-weight)}
.cwn-update-section-toggle{cursor:pointer;user-select:none}
.cwn-update-fold svg{transition:transform 220ms cubic-bezier(.2,0,0,1)}
.cwn-update-fold[aria-expanded=false] svg{transform:rotate(-90deg)}
.cwn-update-item{padding:var(--cwn-settings-row-padding) 0}
.cwn-update-item+.cwn-update-item{border-top:var(--cwn-settings-border)}
.cwn-update-row{display:flex;align-items:center;justify-content:space-between;gap:var(--cwn-settings-column-gap)}
.cwn-update-row-main{display:flex;align-items:flex-start;gap:12px;min-width:0;flex:1}
.cwn-update-row-main>.cwn-brand{flex-shrink:0;margin-top:6px;border-radius:8px;overflow:hidden}
.cwn-update-text{display:flex;flex-direction:column;gap:var(--cwn-settings-description-gap);min-width:0}
.cwn-update-name{font-size:var(--cwn-settings-label-size);line-height:var(--cwn-settings-label-line);font-weight:var(--cwn-settings-label-weight);color:var(--dsw-alias-label-primary)}
.cwn-update-desc{display:flex;align-items:center;flex-wrap:wrap;gap:6px;min-width:0;font-size:var(--cwn-settings-description-size);line-height:var(--cwn-settings-description-line);color:var(--dsw-alias-label-tertiary);overflow-wrap:anywhere}
.cwn-update-desc>span{min-width:0}
.cwn-update-desc:has(>[data-state]){flex-wrap:nowrap;align-items:flex-start}
.cwn-update-desc>[data-state]{flex-shrink:0;margin-top:3px}
.cwn-update-desc>[data-state=done]{margin-top:6px}
.cwn-update-desc[data-tone=error]{color:var(--dsw-alias-state-error-primary)}
.cwn-update-desc[data-tone=warn]{color:var(--dsw-alias-state-warn-label)}
.cwn-update-desc[data-tone=ok]{color:var(--dsw-alias-label-primary)}
.cwn-update-desc .cwn-update-link{appearance:none;border:0;padding:0;margin:0;background:transparent;color:inherit;font:inherit;text-decoration:underline;text-underline-offset:2px;cursor:pointer}
.cwn-update-desc .cwn-update-link:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px}
.cwn-update-notice{font-size:var(--cwn-settings-description-size);line-height:var(--cwn-settings-description-line);color:var(--dsw-alias-label-tertiary);overflow-wrap:anywhere;white-space:normal}
.cwn-update-row-error{margin:0;font-size:var(--cwn-settings-description-size);line-height:var(--cwn-settings-feedback-line);color:var(--dsw-alias-state-error-primary);overflow-wrap:anywhere}
.cwn-update-actions{display:flex;align-items:center;justify-content:flex-end;flex-wrap:wrap;gap:var(--cwn-settings-action-gap);flex-shrink:0;max-width:100%}
.cwn-update-actions button{white-space:nowrap}
.cwn-update-expand{display:flex;flex-direction:column;gap:8px;margin:12px 0 0 44px;min-width:0}
.cwn-update-bubble{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:12px 0 0 44px;padding:10px 12px;border-radius:12px;background:var(--dsw-alias-interactive-bg-hover);min-width:0}
.cwn-update-bubble[data-column]{flex-direction:column;align-items:stretch;gap:8px}
.cwn-update-bubble .cwn-update-actions{align-self:auto}
.cwn-update-bubble[data-column] .cwn-update-actions{align-self:flex-end}
.cwn-update-bubble .cwn-update-cmd{background:var(--dsw-alias-bg-layer-2)}
.cwn-update-bubble button:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-active)}
.cwn-update-confirm-all{margin:16px 0 0}
.cwn-update-page .cwn-update-confirm-all+.cwn-settings-section{margin-top:28px}
.cwn-update-notice-list{margin:0;padding:0 0 0 16px;display:flex;flex-direction:column;gap:4px;font-size:var(--cwn-settings-description-size);line-height:var(--cwn-settings-description-line);color:var(--dsw-alias-state-warn-label);overflow-wrap:anywhere}
.cwn-update-notice-name{font-weight:var(--cwn-settings-label-weight);color:var(--dsw-alias-label-secondary)}
.cwn-update-note{font-size:var(--cwn-settings-description-size);line-height:var(--cwn-settings-description-line);color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere;min-width:0}
.cwn-update-field-label{font-size:var(--cwn-settings-description-size);line-height:var(--cwn-settings-description-line);color:var(--dsw-alias-label-secondary)}
.cwn-update-field-row{display:flex;align-items:center;gap:8px;min-width:0}
.cwn-update-field-row>span{flex:1;min-width:0}
.cwn-update-field-row input{width:100%;text-overflow:ellipsis}
.cwn-update-browse{width:var(--cwn-settings-control-height)!important;padding:0!important;flex-shrink:0;background:var(--dsw-alias-bg-layer-2)!important}
.cwn-update-hint{font-size:var(--cwn-settings-description-size);line-height:var(--cwn-settings-description-line);color:var(--dsw-alias-label-tertiary);overflow-wrap:anywhere}
.cwn-update-hint[data-tone=error]{color:var(--dsw-alias-state-error-primary)}
.cwn-update-place{font-size:var(--cwn-settings-description-size);line-height:var(--cwn-settings-description-line);color:var(--dsw-alias-label-tertiary);overflow-wrap:anywhere}
.cwn-update-cmd{margin:0;padding:6px 10px;border-radius:8px;background:var(--dsw-alias-interactive-bg-hover);font-family:var(--cwn-update-mono);font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);white-space:pre-wrap;overflow-wrap:anywhere}
.cwn-update-progress{display:flex;flex-direction:column;gap:6px}
.cwn-update-bar{height:4px;border-radius:2px;background:var(--dsw-alias-interactive-bg-hover);overflow:hidden}
.cwn-update-bar>span{display:block;height:100%;border-radius:2px;background:var(--dsw-alias-state-business-primary);transition:width 180ms ease}
.cwn-update-progress-meta{display:flex;justify-content:space-between;flex-wrap:nowrap;gap:12px;min-width:0;font-size:var(--cwn-settings-description-size);line-height:var(--cwn-settings-description-line);color:var(--dsw-alias-label-tertiary)}
.cwn-update-progress-meta[data-tone=warn]{color:var(--dsw-alias-state-warn-label)}
.cwn-update-meta-main{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cwn-update-meta-side{flex-shrink:0;white-space:nowrap}
.cwn-update-seg{display:grid;gap:3px;height:4px}
.cwn-update-seg>span{border-radius:2px;background:var(--dsw-alias-interactive-bg-hover)}
.cwn-update-seg>span[data-step=done]{background:var(--dsw-alias-state-business-primary)}
.cwn-update-seg>span[data-step=now]{background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 45%,transparent)}
.cwn-update-callout{padding:10px 12px;border-radius:12px;background:var(--dsw-alias-interactive-bg-hover);font-size:var(--cwn-settings-description-size);line-height:var(--cwn-settings-description-line);color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere}
.cwn-update-hint[data-clip]{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;overflow-wrap:normal}
.cwn-update-chan{display:inline-flex;align-items:center;flex-shrink:0;height:20px;margin:-1px 0;padding:0 6px;border-radius:6px;font-size:var(--cwn-settings-description-size);line-height:var(--cwn-settings-description-line);color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-interactive-bg-hover);white-space:nowrap}
.cwn-update-chan[data-channel=takeover]{color:var(--dsw-alias-state-business-primary);background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 10%,transparent)}
.cwn-update-log-head{display:flex;align-items:center;justify-content:space-between;gap:12px;font-size:var(--cwn-settings-description-size);line-height:var(--cwn-settings-description-line);color:var(--dsw-alias-label-tertiary)}
.cwn-update-log{margin:0;height:150px;overflow:auto;overscroll-behavior:contain;padding:10px 12px;border-radius:12px;background:var(--dsw-alias-interactive-bg-hover);font-family:var(--cwn-update-mono);font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);white-space:pre-wrap;overflow-wrap:anywhere}
.cwn-update-line{display:flex;align-items:center;flex-wrap:wrap;gap:8px 12px;padding:16px 0;font-size:var(--cwn-settings-description-size);line-height:var(--cwn-settings-feedback-line);color:var(--dsw-alias-label-tertiary);overflow-wrap:anywhere}
.cwn-update-line[data-tone=error]{color:var(--dsw-alias-state-error-primary)}
.cwn-update-line>span{flex:1;min-width:0}
@media(max-width:640px){
.cwn-update-check{width:var(--cwn-settings-control-height)!important;padding:0!important}
.cwn-update-check .cwn-update-check-label{position:absolute;width:1px;height:1px;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap}
.cwn-update-row{gap:12px}
}
@media(prefers-reduced-motion:reduce){.cwn-update-fold svg,.cwn-update-bar>span{transition:none}}
`
