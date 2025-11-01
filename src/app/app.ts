import { Component, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { ThreeScene } from './three-scene/three-scene';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, ThreeScene],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App {
  protected readonly title = signal('avatar');
}
