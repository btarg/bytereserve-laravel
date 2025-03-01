<?php

namespace App\Console\Commands;

use App\Models\Folder;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

class RecalculateFolderSizes extends Command
{
    protected $signature = 'folders:recalculate-sizes';
    protected $description = 'Recalculate all folder sizes recursively';

    public function handle()
    {
        $this->info('Starting folder size recalculation...');
        $count = 0;

        try {
            // Get all root folders (no parent)
            $rootFolders = Folder::whereNull('parent_id')->get();

            $this->info('Found ' . $rootFolders->count() . ' root folders');
            $this->output->progressStart($rootFolders->count());

            foreach ($rootFolders as $folder) {
                DB::beginTransaction();
                
                try {
                    $this->recalculateFolderSizeRecursive($folder);
                    $count++;
                    DB::commit();
                } catch (\Exception $e) {
                    DB::rollBack();
                    Log::error('Failed to recalculate folder size', [
                        'folder_id' => $folder->id,
                        'error' => $e->getMessage()
                    ]);
                    $this->error('Error processing folder ' . $folder->id . ': ' . $e->getMessage());
                }
                
                $this->output->progressAdvance();
            }

            $this->output->progressFinish();
            $this->info("Successfully recalculated sizes for $count folders");
            
            return Command::SUCCESS;
        } catch (\Exception $e) {
            $this->error('Failed to recalculate folder sizes: ' . $e->getMessage());
            Log::error('Failed to recalculate folder sizes', [
                'error' => $e->getMessage(),
                'trace' => $e->getTraceAsString()
            ]);
            
            return Command::FAILURE;
        }
    }

    private function recalculateFolderSizeRecursive(Folder $folder): void
    {
        // First recalculate all children
        foreach ($folder->children as $child) {
            $this->recalculateFolderSizeRecursive($child);
        }

        // Then calculate this folder's size
        $folder->size = $folder->calculateSize();
        $folder->save();
    }
}