import { route } from "ziggy-js";
import { FolderRecord } from "../database/Schemas";
import { Folders } from "../database/ModelRegistry";

export async function storeNewFolder(currentPath: string, folderName: string) {
    if (!folderName) return;


    // Create on the server
    const response = await window.cacheFetch.post(route('folders.store'), {
        name: folderName,
        parent_path: currentPath
    });

    // Get the newly created folder data
    const folderData = await response.json();

    // Also save to IndexedDB for offline access
    if (folderData && folderData.id) {
        try {
            // Create folder record for IndexedDB
            const folderRecord: FolderRecord = {
                id: folderData.id,
                name: folderData.name,
                type: 'folder',
                path: currentPath === '/' ?
                    `/${folderData.name}` :
                    `${currentPath}/${folderData.name}`,
                parent_id: folderData.parent_id,
                size: 0,
                created_at: Date.now(),
                updated_at: Date.now()
            };

            // Save to IndexedDB
            await Folders().save(folderRecord);
            console.log(`Folder ${folderData.id} saved to IndexedDB`);

        } catch (dbError) {
            console.warn(`Could not save folder to IndexedDB:`, dbError);
        }
    }
}