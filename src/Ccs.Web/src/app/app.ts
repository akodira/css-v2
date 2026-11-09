import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  template: '<router-outlet />',
  host: { class: 'flex min-h-screen flex-1 flex-col' },
})
export class App {}
