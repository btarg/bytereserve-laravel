<?php
namespace App\Http\Controllers\Auth;
use App\Http\Controllers\Controller;
use Illuminate\Support\Facades\Auth;
use Illuminate\Http\Request;
use Laravel\Socialite\Facades\Socialite;
use \App\Models\User;

class SolveProviderConflictController extends Controller
{
    public function solveProviderConflict()
    {
        $conflictData = session()->get('provider_conflict');

        if (
            !$conflictData ||
            now()->isAfter($conflictData['expires_at'])
        ) {
            session()->forget('provider_conflict');
            return redirect()->route('login')
                ->with('error', 'Invalid or expired provider link request');
        }

        return Socialite::driver($conflictData['originalProvider'])
            ->stateless()
            ->redirect();

    }

    public function cancelConflictResolution()
    {
        session()->forget('provider_conflict');
        return redirect()->route('login')
            ->with('status', 'Conflict resolution cancelled');
    }
    
    
}