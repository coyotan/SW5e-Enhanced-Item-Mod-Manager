/**
 * SW5e Mod Manager (DnD5e System Compatible)
 * Logic to handle "Chassis" items as containers for "Modifications"
 * within the DnD5e system using the SW5e Module rules.
 */

Hooks.once('init', () => {
    console.log("SW5e Mod Manager | Initializing for DnD5e System");
    
    // CORE SYSTEM PATCH:
    // This is the only way to bypass the "not a valid type" error in DnD5e 4.x.
    // We must register 'modification' as a valid type in the system's metadata.
    try {
        const itemTypes = Object.keys(game.system.template.Item);
        if (!itemTypes.includes("modification")) {
            // Add to the template so validation passes
            game.system.template.Item["modification"] = game.system.template.Item["loot"];
            
            // Add to the Document types so it can be created
            CONFIG.Item.documentClass.TYPES.push("modification");
            
            // Alias the data model
            if (CONFIG.Item.dataModels) {
                CONFIG.Item.dataModels["modification"] = CONFIG.Item.dataModels["loot"];
            }
            
            // Ensure the system doesn't filter it out of document types
            if (game.documentTypes?.Item) {
                if (!game.documentTypes.Item.includes("modification")) {
                    game.documentTypes.Item.push("modification");
                }
            }
        }
    } catch (e) {
        console.error("SW5e Mod Manager | Failed to patch core Item types", e);
    }

    // SETTINGS: Register individual numeric inputs for each rarity level
    const rarityDefaults = {
        "common": 2, "standard": 2, 
        "uncommon": 3, "premium": 3, 
        "rare": 4, "prototype": 4, 
        "veryrare": 5, "advanced": 5, 
        "legendary": 6, 
        "artifact": 8
    };

    for (let [rarity, count] of Object.entries(rarityDefaults)) {
        game.settings.register('sw5e-mod-manager', `slots-${rarity}`, {
            name: `Max Slots: ${rarity.charAt(0).toUpperCase() + rarity.slice(1)}`,
            hint: `Define how many modification slots a ${rarity} chassis has.`,
            scope: 'world',
            config: true,
            type: Number,
            default: count
        });
    }
});

/**
 * INTERCEPTOR: Automatically wrap modifications upon creation
 * This prevents the DnD5e system from rejecting the "modification" type
 * when a DM or player tries to create one or drag one from a compendium.
 */
Hooks.on("preCreateItem", (item, data, options, userId) => {
    // Only intercept if the type is explicitly "modification"
    if (data.type !== "modification") return;

    console.log(`SW5e Mod Manager | Intercepting creation of ${data.name}. Wrapping as loot...`);

    // Create the "wrapped" structure
    const originalModData = item.toObject();
    
    // Mutate the creation data to be a valid "loot" item
    const updates = {
        type: "loot",
        flags: {
            "sw5e-mod-manager": {
                isWrappedMod: true,
                originalModData: originalModData
            }
        }
    };

    // Apply mutation to the source data before it hits the database
    item.updateSource(updates);
});

/**
 * Hook to add "Wrap Modification" to the item context menu 
 */
Hooks.on('getItemDirectoryEntryContext', (html, entryOptions) => {
    entryOptions.push({
        name: "Wrap as SW5e Modification",
        icon: '<i class="fas fa-box-open"></i>',
        condition: li => {
            const itemId = li.data("documentId");
            const item = game.items.get(itemId);
            return item && isModification(item) && !item.getFlag('sw5e-mod-manager', 'isWrappedMod');
        },
        callback: li => {
            const item = game.items.get(li.data("documentId"));
            wrapModification(item);
        }
    });
});

Hooks.on('getItemActorContext', (html, entryOptions) => {
    entryOptions.push({
        name: "Wrap as SW5e Modification",
        icon: '<i class="fas fa-box-open"></i>',
        condition: li => {
            const actorId = html.closest(".actor").data("documentId");
            const actor = game.actors.get(actorId);
            const itemId = li.data("itemId") || li.data("documentId");
            const item = actor?.items.get(itemId);
            return item && isModification(item) && !item.getFlag('sw5e-mod-manager', 'isWrappedMod');
        },
        callback: li => {
            const actorId = html.closest(".actor").data("documentId");
            const actor = game.actors.get(actorId);
            const itemId = li.data("itemId") || li.data("documentId");
            const item = actor?.items.get(itemId);
            wrapModification(item);
        }
    });
});

/**
 * Transforms a raw "modification" type item into a "loot" container manually
 */
async function wrapModification(item) {
    const originalData = item.toObject();
    
    const lootWrapper = {
        name: originalData.name,
        type: "loot",
        img: originalData.img,
        system: {
            description: originalData.system.description,
            rarity: originalData.system.rarity,
            weight: originalData.system.weight || 0,
            price: originalData.system.price || 0
        },
        flags: {
            "sw5e-mod-manager": {
                isWrappedMod: true,
                originalModData: originalData
            }
        }
    };

    if (item.parent) {
        await item.parent.createEmbeddedDocuments("Item", [lootWrapper]);
        await item.delete();
    } else {
        await Item.create(lootWrapper);
        await item.delete();
    }
    
    if (window.ui && ui.notifications) {
        ui.notifications.info(`${originalData.name} has been wrapped for player inventory compatibility.`);
    }
}

/**
 * Robust helper to determine if an item is a modification.
 */
function isModification(item) {
    if (!item) return false;
    if (item.getFlag('sw5e-mod-manager', 'isWrappedMod')) return true;
    const uuid = item.uuid?.toLowerCase() || "";
    if (uuid.includes('modifications')) return true;
    const nameMatch = item.name?.toLowerCase().includes('modification');
    const typeValue = item.system?.type?.value?.toLowerCase() || "";
    const typeLabel = item.system?.type?.label?.toLowerCase() || "";
    const typeMatch = typeValue.includes('modification') || typeLabel.includes('modification') || item.type === "modification";
    const sw5eFlag = item.getFlag('sw5e', 'type') === 'modification';
    return nameMatch || typeMatch || sw5eFlag;
}

/**
 * Hook into the Item Sheet to add a "Modifications" tab
 */
Hooks.on('renderItemSheet', (app, html, data) => {
    const item = app.item;
    if (!['weapon', 'equipment'].includes(item.type)) return;

    const tabs = html.find('.tabs[data-group="primary"]');
    if (!tabs.find('[data-tab="mods"]').length) {
        tabs.append('<a class="item" data-tab="mods">Modifications</a>');
    }

    const modContent = $(`
        <div class="tab" data-group="primary" data-tab="mods">
        <div class="mod-slots-container">
            <div class="flexrow" style="align-items: center; margin-bottom: 10px;">
                <h3 style="margin: 0;">Installed Modifications ${getSlotCountDisplay(item)}</h3>
            </div>
            ${renderInjectedPropertiesHeader(item)}
            <ol class="items-list">
            <li class="item flexrow item-header">
                <div class="item-name">Mod Name</div>
                <div class="item-controls">Controls</div>
            </li>
            ${renderModList(item)}
            </ol>
            <p class="hint">Drag and drop modifications here to install them.</p>
            <p class="hint">Bonuses and status effects shown in this tab are not automatically applied. You must do this yourself."</p>
        </div>
        </div>
    `);

    if (!html.find('.tab[data-tab="mods"]').length) {
        html.find('.sheet-body').append(modContent);
    }

    // Handle Drag & Drop
    modContent.on('drop', async (ev) => {
        const dropData = JSON.parse(ev.originalEvent.dataTransfer.getData('text/plain'));
        if (dropData.type !== "Item") return;

        const modItem = await Item.fromDropData(dropData);
        if (!isModification(modItem)) {
            ui.notifications.warn(`"${modItem.name}" does not appear to be a valid SW5e modification.`);
            return;
        }

        if (!hasAvailableSlots(item)) {
            ui.notifications.error("This chassis has no available modification slots.");
            return;
        }

        if (!validateRarity(item, modItem)) return;

        showModActionDialog(item, modItem, 'install');
    });

    // Handle Removal
    modContent.find('.mod-delete').on('click', async (ev) => {
        const modId = $(ev.currentTarget).data('mod-id');
        const mods = item.getFlag('sw5e-mod-manager', 'installedMods') || [];
        const modData = mods.find(m => m.id === modId);
        if (modData) showModActionDialog(item, modData, 'remove');
    });

    // Handle Chat Posting
    modContent.find('.mod-chat').on('click', async (ev) => {
        const modId = $(ev.currentTarget).data('mod-id');
        const mods = item.getFlag('sw5e-mod-manager', 'installedMods') || [];
        const modData = mods.find(m => m.id === modId);
        if (modData?.originalData) {
            const chatData = {
                user: game.user.id,
                speaker: ChatMessage.getSpeaker({actor: item.actor}),
                content: `
                    <div class="dnd5e chat-card item-card">
                        <header class="card-header flexrow">
                            <img src="${modData.originalData.img}" title="${modData.name}" width="36" height="36"/>
                            <h3 class="item-name">${modData.name}</h3>
                        </header>
                        <div class="card-content">
                            ${modData.originalData.system.description.value}
                        </div>
                        <footer class="card-footer">
                            <span>Installed on: ${item.name}</span>
                            <span>Rarity: ${modData.rarity}</span>
                        </footer>
                    </div>
                `
            };
            ChatMessage.create(chatData);
        }
    });

    // Handle Description Toggle (Fix: Scoped to specific item and toggles chevron)
    modContent.find('.item-name').on('click', (ev) => {
        const header = $(ev.currentTarget);
        const li = header.closest('.item');
        const summary = li.find('.item-summary');
        const icon = header.find('i.fa-chevron-right, i.fa-chevron-down');

        if (summary.is(':visible')) {
            summary.slideUp(200);
            icon.removeClass('fa-chevron-down').addClass('fa-chevron-right');
        } else {
            summary.slideDown(200);
            icon.removeClass('fa-chevron-right').addClass('fa-chevron-down');
        }
    });
});

/**
 * Slot Validation Helpers
 */
function getSlotCountDisplay(item) {
    const mods = item.getFlag('sw5e-mod-manager', 'installedMods') || [];
    const rarity = (item.system.rarity || "common").toLowerCase().replace(/\s/g, '');
    // Fetch the specific numeric setting for this rarity
    const max = game.settings.get('sw5e-mod-manager', `slots-${rarity}`) ?? 2;
    return `<span style="font-size: 0.8em; color: #666; font-weight: normal;">(${mods.length} / ${max} slots)</span>`;
}

function hasAvailableSlots(item) {
    const mods = item.getFlag('sw5e-mod-manager', 'installedMods') || [];
    const rarity = (item.system.rarity || "common").toLowerCase().replace(/\s/g, '');
    // Fetch the specific numeric setting for this rarity
    const max = game.settings.get('sw5e-mod-manager', `slots-${rarity}`) ?? 2;
    return mods.length < max;
}

function renderInjectedPropertiesHeader(item) {
    const mods = item.getFlag('sw5e-mod-manager', 'installedMods') || [];
    const allProps = mods.flatMap(m => m.properties || []);
    if (allProps.length === 0) return "";
    const uniqueProps = [...new Set(allProps)];
    return `
        <div class="injected-props" style="margin-bottom: 10px; display: flex; gap: 5px; flex-wrap: wrap; border-bottom: 1px solid #c9c7b8; padding-bottom: 10px;">
            <span style="font-weight: bold; font-size: 0.8em; align-self: center; margin-right: 5px;">Active Tags:</span>
            ${uniqueProps.map(p => `<span style="background: #222; color: #00ffcc; border: 1px solid #00ffcc; padding: 1px 8px; border-radius: 4px; font-size: 0.75em; text-transform: uppercase; font-family: 'Signika', sans-serif;"><i class="fas fa-microchip" style="font-size: 0.8em;"></i> ${p}</span>`).join('')}
        </div>
    `;
}

function validateRarity(chassis, mod) {
    const rarityScale = {
        "common": 1, "standard": 1, "uncommon": 2, "premium": 2, "rare": 3, "prototype": 3, "veryrare": 4, "advanced": 4, "legendary": 5, "artifact": 6
    };
    const chassisRarityStr = (chassis.system.rarity || "common").toLowerCase().replace(/\s/g, '');
    const modRarityStr = (mod.system.rarity || "common").toLowerCase().replace(/\s/g, '');
    const chassisRank = rarityScale[chassisRarityStr] || 1;
    const modRank = rarityScale[modRarityStr] || 1;
    if (modRank > chassisRank) {
        ui.notifications.error(`Cannot install ${modRarityStr} modification on a ${chassisRarityStr} chassis.`);
        return false;
    }
    return true;
}

function renderEffectChanges(effects) {
    if (!effects || effects.length === 0) return "";
    let rows = [];
    effects.forEach(eff => {
        if (!eff.changes) return;
        eff.changes.forEach(c => {
            const modeLabel = c.mode === 2 ? "+" : (c.mode === 1 ? "×" : "=");
            rows.push(`<div class="effect-change" style="display: flex; justify-content: space-between; font-family: monospace; font-size: 0.9em; background: rgba(0,0,0,0.05); padding: 2px 5px; margin-bottom: 2px; border-radius: 3px;">
                <span>${c.key}</span>
                <span style="color: #2e7d32; font-weight: bold;">${modeLabel}${c.value}</span>
            </div>`);
        });
    });
    if (rows.length === 0) return "";
    return `
        <div class="mod-applied-effects" style="margin-top: 8px; border-top: 1px dashed #ccc; padding-top: 5px;">
            <div style="font-weight: bold; font-size: 0.8em; margin-bottom: 3px; color: #555; text-transform: uppercase;">Active Effect Injection:</div>
            ${rows.join('')}
        </div>
    `;
}

function renderModList(item) {
    const mods = item.getFlag('sw5e-mod-manager', 'installedMods') || [];
    if (mods.length === 0) return '<li class="item flexrow">No mods installed.</li>';
    return mods.map(m => `
        <li class="item flexcol" data-mod-id="${m.id}" style="border-bottom: 1px solid #c9c7b8;">
        <div class="flexrow" style="padding: 5px 0;">
            <div class="item-name" style="cursor: pointer; flex: 1;">
                <i class="fas fa-chevron-right" style="font-size: 0.7em;"></i> <strong>${m.name}</strong>
            </div>
            <div class="item-controls" style="flex: 0 0 60px; text-align: right;">
                <a class="mod-chat" data-mod-id="${m.id}" title="Post to Chat" style="margin-right: 8px;"><i class="fas fa-comment"></i></a>
                <a class="mod-delete" data-mod-id="${m.id}" title="Uninstall"><i class="fas fa-tools"></i></a>
            </div>
        </div>
        <div class="item-summary" style="display: none; padding: 8px 20px; font-size: 0.85em; background: rgba(0,0,0,0.03);">
            <div class="mod-description">${m.originalData?.system?.description?.value || "No description available."}</div>
            ${renderEffectChanges(m.effects)}
            ${m.properties?.length ? `<div style="margin-top: 10px; color: #444; font-size: 0.9em; border-top: 1px dashed #ccc; padding-top: 5px;"><strong>Properties Injected:</strong> ${m.properties.join(', ')}</div>` : ''}
        </div>
        </li>
    `).join('');
}

async function showModActionDialog(chassis, mod, actionType) {
    const isInstall = actionType === 'install';
    const title = isInstall ? `Install ${mod.name}` : `Remove ${mod.name}`;
    const rarities = { 'common': 10, 'standard': 10, 'uncommon': 14, 'premium': 14, 'rare': 18, 'prototype': 18, 'veryrare': 22, 'advanced': 22, 'legendary': 26, 'artifact': 30 };
    const rarityKey = (mod.system?.rarity || mod.rarity || 'common').toLowerCase().replace(/\s/g, '');
    const dc = rarities[rarityKey] || 14;
    
    let content = `<p>How would you like to ${isInstall ? 'install' : 'remove'} this modification?</p>`;
    content += `<p><strong>Required DC:</strong> ${dc} (Intelligence + Tools)</p>`;
    
    if (!isInstall) {
        content += `
            <div class="form-group" style="display: flex; align-items: center; gap: 10px; margin-top: 10px; padding: 10px; background: rgba(0,0,0,0.05); border-radius: 4px;">
                <label for="destroy-on-failure" style="flex: 1; font-weight: bold;">Destroy on failure?</label>
                <input type="checkbox" id="destroy-on-failure" checked style="width: 18px; height: 18px; cursor: pointer;" />
            </div>
            <p class="hint" style="font-size: 0.8em; margin-top: 5px;">If unchecked, a failed roll keeps the mod on the weapon.</p>
        `;
    }

    new Dialog({
        title: title,
        content: content,
        buttons: {
            roll: {
                label: "Roll Check",
                callback: async (html) => {
                    const actor = chassis.actor;
                    if (!actor) return;
                    
                    // Retrieve checkbox state
                    const destroyOnFail = !isInstall && html.find('#destroy-on-failure').is(':checked');
                    
                    // Correct Roll evaluation for V12 (awaiting evaluate() without the deprecated async option)
                    const roll = await new Roll("1d20 + @abilities.int.mod + @prof", actor.getRollData()).evaluate();
                    roll.toMessage({ flavor: `${title} - Skill Check (DC ${dc})` });
                    
                    if (roll.total >= dc) {
                        ui.notifications.info("Success!");
                        isInstall ? performInstall(chassis, mod) : performRemove(chassis, mod.id, true);
                    } else {
                        if (isInstall) {
                            ui.notifications.warn("Installation failed.");
                        } else {
                            if (destroyOnFail) {
                                ui.notifications.error("Failure! The modification was destroyed during removal.");
                                performRemove(chassis, mod.id, false);
                            } else {
                                ui.notifications.warn("Uninstall failed. The modification remains installed on the weapon.");
                            }
                        }
                    }
                }
            },
            direct: { 
                label: "Direct (Skip Roll)", 
                callback: () => { 
                    isInstall ? performInstall(chassis, mod) : performRemove(chassis, mod.id, true); 
                } 
            },
            cancel: { label: "Cancel" }
        },
        default: "roll"
    }).render(true);
}

function getInjectedProperties(mod) {
    const knownProperties = ['brutal', 'keen', 'vicious', 'defensive', 'shielding', 'vibration', 'ion', 'reach', 'versatile', 'biting', 'corruption', 'disarming', 'disruptive', 'electrified', 'hidden', 'penetrating', 'rapid', 'shocking', 'silent'];
    const found = [];
    const nameLower = mod.name.toLowerCase();
    knownProperties.forEach(p => { if (nameLower.includes(p)) found.push(p); });
    if (mod.system?.properties) { Object.keys(mod.system.properties).forEach(p => { if (mod.system.properties[p] === true) found.push(p); }); }
    return found;
}

async function performInstall(chassis, mod) {
    const currentMods = chassis.getFlag('sw5e-mod-manager', 'installedMods') || [];
    const injectedProps = getInjectedProperties(mod);
    let modData = mod.toObject();
    if (mod.getFlag('sw5e-mod-manager', 'isWrappedMod')) {
        modData = mod.getFlag('sw5e-mod-manager', 'originalModData');
    }
    let modEffects = [];
    if (mod.effects && typeof mod.effects.map === "function") { modEffects = mod.effects.map(e => e.toObject()); } 
    else if (mod.effects && mod.effects.contents) { modEffects = mod.effects.contents.map(e => e.toObject()); }
    const processedEffects = modEffects.map(effect => {
        effect.transfer = true; 
        effect.origin = chassis.uuid; 
        effect.flags = foundry.utils.mergeObject(effect.flags || {}, { "sw5e-mod-manager": { sourceMod: mod.id } });
        return effect;
    });
    const newModData = { id: mod.id, name: mod.name, uuid: mod.uuid, rarity: mod.system.rarity, originalData: modData, properties: injectedProps, effects: processedEffects };
    const updatedMods = [...currentMods, newModData];
    await chassis.setFlag('sw5e-mod-manager', 'installedMods', updatedMods);
    if (processedEffects.length > 0) {
        try { await chassis.createEmbeddedDocuments("ActiveEffect", processedEffects); } catch (err) { console.error("SW5e Mod Manager | Active Effects Error:", err); }
    }
    if (injectedProps.length > 0) {
        const currentProps = Array.isArray(chassis.system.properties) ? chassis.system.properties : Array.from(chassis.system.properties || []);
        const newProps = [...new Set([...currentProps, ...injectedProps])];
        await chassis.update({ "system.properties": newProps });
    }
    if (chassis.actor) {
        const itemInInv = chassis.actor.items.get(mod.id);
        if (itemInInv) await itemInInv.delete();
    }
    ui.notifications.info(`${mod.name} installed.`);
}

async function performRemove(chassis, modId, isSalvaged) {
    const currentMods = chassis.getFlag('sw5e-mod-manager', 'installedMods') || [];
    const modToRemoval = currentMods.find(m => m.id === modId);
    const updatedMods = currentMods.filter(m => m.id !== modId);
    await chassis.setFlag('sw5e-mod-manager', 'installedMods', updatedMods);
    const effectsToDelete = chassis.effects.filter(e => e.getFlag('sw5e-mod-manager', 'sourceMod') === modId);
    if (effectsToDelete.length > 0) { await chassis.deleteEmbeddedDocuments("ActiveEffect", effectsToDelete.map(e => e.id)); }
    if (modToRemoval?.properties?.length > 0) {
        const currentProps = Array.isArray(chassis.system.properties) ? chassis.system.properties : Array.from(chassis.system.properties || []);
        const filteredProps = currentProps.filter(p => !modToRemoval.properties.includes(p));
        await chassis.update({ "system.properties": filteredProps });
    }
    if (isSalvaged && chassis.actor && modToRemoval?.originalData) {
        const originalModData = modToRemoval.originalData;
        const lootWrapper = { name: originalModData.name, type: "loot", img: originalModData.img, system: { description: originalModData.system.description, rarity: originalModData.system.rarity, weight: originalModData.system.weight || 0, price: originalModData.system.price || 0 }, flags: { "sw5e-mod-manager": { isWrappedMod: true, originalModData: originalModData } } };
        await chassis.actor.createEmbeddedDocuments("Item", [lootWrapper]);
        ui.notifications.info(`${modToRemoval.name} salvaged.`);
    } else if (!isSalvaged) { 
        ui.notifications.warn(`${modToRemoval.name} destroyed.`); 
    }
}